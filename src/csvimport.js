// CSV import: transactions from a bank's CSV export, for a bank Enable Banking doesn't cover, or for history
// from before your bank was linked (banks share about 90 days). Every bank exports its own columns, so
// nothing here is bank-specific: the separator, the decimal comma and the date format are detected, the
// columns guessed from their names (Dutch, French, English), and you confirm them before anything is saved.
// The confirmed columns are remembered for that set of column names.
//
// An imported account is a "csv-…" account with its own session that never expires: sync, the access
// reminders and linking leave it alone. When the same IBAN is also linked through your bank, the bank's own
// transactions take over from the first day it has, and the CSV keeps only the history before that.
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { applyRules, normIban } from './categories.js';
import { loadSettings, saveSettings } from './settings.js';
import { SAMPLE_SESSION, removeSampleData } from './sample.js';

export const MAX_CHARS = 5_000_000;
export const CSV_PREFIX = 'csv-';
const NEVER = '9999-12-31T23:59:59Z';
const hash = (s, n = 32) => createHash('sha256').update(s).digest('hex').slice(0, n);

// ---------- reading the file ----------

const countOutside = (line, sep) => {
  let n = 0, quoted = false;
  for (const c of line) { if (c === '"') quoted = !quoted; else if (c === sep && !quoted) n++; }
  return n;
};

// Rows of cells. The separator is whichever of ; , or tab the first lines use most.
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const head = src.split(/\r?\n/).slice(0, 5).join('\n');
  const sep = [';', ',', '\t'].map((s) => [s, countOutside(head, s)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  row.push(field);
  rows.push(row);
  return { sep, rows: rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some(Boolean)) };
}

// The header is the first row as wide as most rows: some banks put a few lines of account details above it.
export function splitHeader(rows) {
  const widths = new Map();
  for (const r of rows) widths.set(r.length, (widths.get(r.length) ?? 0) + 1);
  const width = [...widths].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  const at = rows.findIndex((r) => r.length === width);
  return { header: rows[at] ?? [], body: rows.slice(at + 1).filter((r) => r.length === width) };
}

// ---------- amounts and dates ----------

// "1.234,56", "-12,34", "1,234.56", "€ 12.30", "12,30-", "(5,00)" -> cents (NaN when it isn't an amount).
export function parseAmount(raw) {
  let s = String(raw ?? '').replace(/[\s  ]/g, '').replace(/[€$£]|EUR|USD|GBP/gi, '');
  if (!s) return NaN;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (s.endsWith('-')) { sign = -sign; s = s.slice(0, -1); }
  if (s.startsWith('-')) { sign = -sign; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,']+$/.test(s)) return NaN;
  s = s.replace(/'/g, '');
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let decimal = null;
  if (lastDot >= 0 && lastComma >= 0) decimal = lastDot > lastComma ? '.' : ',';
  else if (lastComma >= 0) decimal = /,\d{1,2}$/.test(s) && (s.match(/,/g).length === 1) ? ',' : null;
  else if (lastDot >= 0) decimal = /\.\d{1,2}$/.test(s) && (s.match(/\./g).length === 1) ? '.' : null;
  const [whole, frac = ''] = decimal ? [s.slice(0, s.lastIndexOf(decimal)), s.slice(s.lastIndexOf(decimal) + 1)] : [s, ''];
  // Thousands separators only between groups of three digits: "12,345,67" isn't an amount.
  if (!/^(\d*|\d{1,3}([.,]\d{3})+)$/.test(whole) || !/^\d{0,2}$/.test(frac) || (!whole && !frac)) return NaN;
  const digits = whole.replace(/[.,]/g, '');
  return sign * (Number(digits || 0) * 100 + Number(frac.padEnd(2, '0') || 0));
}

const FORMATS = {
  ymd: /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/,
  dmy: /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?!\d)/,
  mdy: /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?!\d)/,
};
function toIso(format, raw) {
  const m = String(raw ?? '').trim().match(FORMATS[format]);
  if (!m) return null;
  let [y, mo, d] = format === 'ymd' ? [m[1], m[2], m[3]] : format === 'dmy' ? [m[3], m[2], m[1]] : [m[3], m[1], m[2]];
  if (y.length === 2) y = `20${y}`;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
// The first format every date in the column fits: year first, then day first (as in Belgium), then month first.
export function dateFormat(values) {
  const filled = values.filter((v) => String(v ?? '').trim());
  return Object.keys(FORMATS).find((f) => filled.length && filled.every((v) => toIso(f, v))) ?? null;
}

// ---------- which column is which ----------

export const FIELDS = ['date', 'amount', 'debit', 'credit', 'counterparty', 'counterpartyIban', 'description', 'description2', 'currency', 'account'];
const GUESS = [
  ['counterpartyIban', /tegenrekening|rekening\s*(van\s*de\s*)?tegenpartij|iban\s*tegenpartij|rekeningnummer\s*tegenpartij|compte\s*(de\s*la\s*)?contrepartie|counterparty\s*(account|iban)|beneficiary\s*(account|iban)/i],
  ['date', /^(boekings?datum|uitvoeringsdatum|verrichtingsdatum|transactiedatum|datum|date(\s*(d'exécution|comptable|de\s*l'opération))?|booking\s*date|transaction\s*date|posting\s*date)$/i],
  ['amount', /^(bedrag|montant|amount|bedrag\s*\(eur\)|montant\s*\(eur\)|amount\s*\(eur\))$/i],
  ['debit', /^(debet|débit|debit|uitgaand|af|money\s*out|paid\s*out)$/i],
  ['credit', /^(credit|crédit|krediet|inkomend|bij|money\s*in|paid\s*in)$/i],
  ['counterparty', /^(naam(\s*tegenpartij)?|tegenpartij|naam\s*\/\s*omschrijving|nom(\s*de\s*la\s*contrepartie)?|contrepartie|counterparty(\s*name)?|beneficiary|begunstigde|payee|name)$/i],
  ['description', /^(omschrijving|mededeling(en)?|vrije\s*mededeling|communication|description|détails|details|libellé|reference|referentie)$/i],
  ['currency', /^(munt|devise|currency)$/i],
  ['account', /^(rekening(nummer)?|mijn\s*rekening|uw\s*rekening|compte|votre\s*compte|account(\s*number)?|iban)$/i],
];
// { field: column index }, from the column names. Two description columns are both kept (description2).
export function guessMapping(header) {
  const mapping = {};
  const used = new Set();
  const names = header.map((h) => String(h).trim().replace(/\s+/g, ' '));
  for (const [field, re] of GUESS) {
    for (let i = 0; i < names.length; i++) {
      if (used.has(i) || !re.test(names[i])) continue;
      if (field === 'description' && mapping.description != null) { mapping.description2 = i; used.add(i); break; }
      mapping[field] = i; used.add(i);
      if (field !== 'description') break;
    }
  }
  return mapping;
}

export const headerKey = (header) => hash(header.map((h) => String(h).trim().toLowerCase()).join('|'), 16);

// ---------- rows to transactions ----------

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/;
const cell = (row, i) => (i == null || i < 0 ? '' : String(row[i] ?? '').trim());

// -> { txs: [{ date, cents, currency, counterparty, counterpartyIban, description, raw }], problems, iban }
export function toTransactions(header, body, mapping) {
  const format = mapping.date == null ? null : dateFormat(body.map((r) => cell(r, mapping.date)));
  const txs = [];
  const problems = [];
  for (const [n, row] of body.entries()) {
    const date = format ? toIso(format, cell(row, mapping.date)) : null;
    let cents = NaN;
    if (mapping.amount != null) cents = parseAmount(cell(row, mapping.amount));
    else if (mapping.debit != null || mapping.credit != null) {
      const out = cell(row, mapping.debit) ? Math.abs(parseAmount(cell(row, mapping.debit))) : 0;
      const inn = cell(row, mapping.credit) ? Math.abs(parseAmount(cell(row, mapping.credit))) : 0;
      cents = inn - out;
    }
    if (!date || !Number.isFinite(cents)) {
      problems.push({ row: n + 1, reason: !date ? 'no date' : 'no amount' });
      continue;
    }
    const ibanText = cell(row, mapping.counterpartyIban);
    const iban = ibanText ? normIban(ibanText) : null;
    const description = [cell(row, mapping.description), cell(row, mapping.description2)].filter(Boolean).join(' ') || null;
    txs.push({
      date, cents,
      currency: (cell(row, mapping.currency) || 'EUR').toUpperCase().slice(0, 3),
      counterparty: cell(row, mapping.counterparty) || null,
      counterpartyIban: iban && IBAN.test(iban) ? iban : null,
      description,
      raw: Object.fromEntries(header.map((h, i) => [h || `column ${i + 1}`, row[i] ?? ''])),
    });
  }
  // Your own IBAN counts only when every row of that column agrees: a column that holds other IBANs (the
  // counterparty's, guessed wrong) must never make them count as yours.
  const ownValues = new Set(body.map((r) => cell(r, mapping.account)).filter(Boolean).map(normIban));
  const [onlyOne] = ownValues;
  const own = ownValues.size === 1 && IBAN.test(onlyOne) ? onlyOne : null;
  return { txs, problems, iban: own };
}

// What the import page shows before anything is saved: the columns, the mapping (remembered or guessed),
// and the first rows as they'd be imported.
export function preview(text, mapping = null) {
  if (String(text).length > MAX_CHARS) throw Object.assign(new Error('That file is too big: split it into smaller exports (up to 5 MB)'), { status: 413 });
  const { header, body } = splitHeader(parseCsv(text).rows);
  if (header.length < 2 || !body.length) throw Object.assign(new Error('That doesn’t look like a CSV export with transactions: choose the CSV file your bank made'), { status: 400 });
  const saved = loadSettings().csvMappings?.[headerKey(header)] ?? null;
  const used = cleanMapping(mapping ?? saved ?? guessMapping(header), header.length);
  const { txs, problems, iban } = toTransactions(header, body, used);
  const dates = txs.map((t) => t.date).sort();
  return {
    header, mapping: used, remembered: !mapping && !!saved,
    rows: body.length, count: txs.length, problems: problems.slice(0, 5), problemCount: problems.length,
    from: dates[0] ?? null, to: dates.at(-1) ?? null, iban,
    sample: txs.slice(0, 6).map(({ raw, ...t }) => t),
  };
}

// Only known fields, each a column that exists.
function cleanMapping(mapping, width) {
  const out = {};
  for (const f of FIELDS) {
    const i = mapping?.[f];
    if (Number.isInteger(i) && i >= 0 && i < width) out[f] = i;
  }
  return out;
}

// ---------- saving ----------

export const isCsvAccount = (uid) => String(uid).startsWith(CSV_PREFIX);

// Saves the transactions into a CSV account (made the first time). Rows already there are skipped, so
// importing the same or an overlapping export again only adds what's new.
export function importCsv({ text, mapping, name, bank }) {
  const accountName = String(name ?? '').trim().slice(0, 80);
  const bankName = String(bank ?? '').trim().slice(0, 80);
  if (!accountName) throw Object.assign(new Error('Give the account a name'), { status: 400 });
  if (!bankName) throw Object.assign(new Error('Say which bank the export is from'), { status: 400 });
  const p = preview(text, mapping);
  if (p.mapping.date == null || (p.mapping.amount == null && p.mapping.debit == null && p.mapping.credit == null)) {
    throw Object.assign(new Error('Choose at least the date and the amount column'), { status: 400 });
  }
  const { header, body } = splitHeader(parseCsv(text).rows);
  const { txs, iban } = toTransactions(header, body, p.mapping);
  if (!txs.length) throw Object.assign(new Error('None of the rows had a date and an amount: check the columns'), { status: 400 });

  const uid = `${CSV_PREFIX}${hash(iban ?? `${bankName}|${accountName}`.toLowerCase(), 16)}`;
  const insert = db.prepare(`INSERT OR IGNORE INTO transactions
    (id, account_uid, booking_date, value_date, amount_cents, currency, counterparty, counterparty_iban, description, status, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'BOOK', ?)`);
  const seen = new Map();
  let added = 0;
  db.exec('BEGIN');
  try {
    removeSampleData(); // your own transactions are in: the sample would only mix with them
    db.prepare('INSERT INTO sessions (id, bank, valid_until) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET bank = excluded.bank').run(uid, bankName, NEVER);
    db.prepare(`INSERT INTO accounts (uid, session_id, bank, iban, name, currency, last_synced) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET bank = excluded.bank, name = excluded.name, last_synced = excluded.last_synced`)
      .run(uid, uid, bankName, iban, accountName, txs[0].currency, new Date().toISOString());
    for (const t of txs) {
      // Two identical payments on the same day are both kept: the nth of them gets its own id.
      const fingerprint = [t.date, t.cents, t.counterparty, t.description].join('|');
      const n = (seen.get(fingerprint) ?? 0) + 1;
      seen.set(fingerprint, n);
      added += Number(insert.run(`${uid}:c_${hash(`${fingerprint}|${n}`)}`, uid, t.date, t.date, t.cents, t.currency,
        t.counterparty, t.counterpartyIban, t.description, JSON.stringify(t.raw)).changes);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const covered = dropCsvOverlap();
  applyRules();
  const settings = loadSettings();
  settings.csvMappings = { ...settings.csvMappings, [headerKey(header)]: p.mapping };
  saveSettings(settings);
  return { uid, added, already: txs.length - added, covered, skipped: p.problemCount };
}

// The bank's own first and last day in each month it has transactions for: { 'YYYY-MM': [first, last] }.
export function bankDaysPerMonth(dates) {
  const span = {};
  for (const d of dates) {
    const month = d.slice(0, 7);
    const [first, last] = span[month] ?? [d, d];
    span[month] = [d < first ? d : first, d > last ? d : last];
  }
  return span;
}
// A CSV row is the bank's too when it falls between the bank's own first and last day of that month. Evidence
// per month, both ways, with no clock or window: a stray date (1970) speaks only for its own day, years of
// history are matched month by month, and where the bank's data starts or stops mid-month (its first month,
// access that ended), the days outside it stay the CSV's.
export function coveredByBank(date, span) {
  const days = span[date.slice(0, 7)];
  const day = date.slice(0, 10);
  return !!days && day >= days[0] && day <= days[1];
}

// A CSV account whose IBAN is also linked through your bank: where the bank has the same days, its own
// transactions count and the CSV's go. Returns how many were dropped. Only booked transactions count as the
// bank's, the same ones sync keeps for good: pending ones (and ones without a status) are replaced every sync.
// Sample accounts never count.
export function dropCsvOverlap() {
  const pairs = db.prepare(`SELECT c.uid AS csv, b.uid AS bank
    FROM accounts c JOIN accounts b ON b.iban = c.iban AND b.uid NOT LIKE '${CSV_PREFIX}%' AND b.session_id != ?
    WHERE c.uid LIKE '${CSV_PREFIX}%' AND c.iban IS NOT NULL`).all(SAMPLE_SESSION);
  const DATE = "booking_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'";
  const bankDates = db.prepare(`SELECT substr(booking_date, 1, 10) AS d FROM transactions WHERE account_uid = ? AND ${DATE} AND status = 'BOOK'`);
  const csvRows = db.prepare(`SELECT id, substr(booking_date, 1, 10) AS d FROM transactions WHERE account_uid = ? AND ${DATE}`);
  const remove = db.prepare('DELETE FROM transactions WHERE id = ?');
  const banks = new Map(); // csv account -> the dates of every bank account with its IBAN
  for (const p of pairs) banks.set(p.csv, [...(banks.get(p.csv) ?? []), ...bankDates.all(p.bank).map((r) => r.d)]);
  let dropped = 0;
  db.exec('BEGIN');
  try {
    for (const [csv, dates] of banks) {
      const span = bankDaysPerMonth(dates);
      for (const row of csvRows.all(csv)) if (coveredByBank(row.d, span)) dropped += Number(remove.run(row.id).changes);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return dropped;
}

// Removes an imported account and its transactions (only ever a CSV one).
export function removeCsvAccount(uid) {
  // Imported is what the database says, not just the id: an imported account sits in its own session.
  const account = db.prepare('SELECT session_id FROM accounts WHERE uid = ?').get(uid);
  if (!isCsvAccount(uid) || account?.session_id !== uid) throw Object.assign(new Error('Only imported accounts can be removed here'), { status: 400 });
  db.exec('BEGIN');
  try {
    const n = db.prepare('DELETE FROM transactions WHERE account_uid = ?').run(uid).changes;
    db.prepare('DELETE FROM accounts WHERE uid = ?').run(uid);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(uid);
    db.exec('COMMIT');
    return { removed: Number(n) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
