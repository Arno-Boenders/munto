// A throwaway world for a test file: its own database, config and "today", so tests never touch your data.
// `node --test` runs every test file in its own process, so each file gets a fresh database.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PAYPAL = { who: 'PayPal Europe S.a.r.l. et Cie S.C.A', desc: 'EUROPESE DOMICILIERING VAN PAYPAL EUROPE S.A.R.L. ET CIE S.C.A MANDAAT NUMMER : TEST0001' };

// today: 'YYYY-MM-DD'; config: merged over config/categories.example.json (with no rules, so categories
// are exactly what the test gives); txs: [{ date, cents, who?, desc?, category?, iban?, oneOff? }].
export async function setup({ today, config = {}, txs = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'munto-test-'));
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.CONFIG_PATH = join(dir, 'categories.json');
  process.env.BUDGET_TODAY = today;
  const example = JSON.parse(readFileSync(new URL('../config/categories.example.json', import.meta.url), 'utf8'));
  const world = { ...example, rules: [], ...config };
  writeFileSync(process.env.CONFIG_PATH, JSON.stringify(world, null, 2));

  const { db } = await import('../src/db.js');
  db.exec("INSERT INTO sessions (id, bank, valid_until) VALUES ('s1', 'Test bank', '2099-01-01')");
  db.exec("INSERT INTO accounts (uid, session_id, bank, iban, name, currency) VALUES ('a1', 's1', 'Test bank', 'BE11000000000011', 'Main', 'EUR')");
  addTxs(db, txs);
  const api = await import('../src/api.js');
  const categories = await import('../src/categories.js');
  const setConfig = (changes) => writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ ...world, ...changes }, null, 2));
  return { api, categories, db, dir, setConfig };
}

let seq = 0;
export function addTxs(db, txs) {
  const insert = db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, value_date, amount_cents, currency, counterparty,
    counterparty_iban, description, status, category, category_source, one_off, raw) VALUES (?, 'a1', ?, ?, ?, 'EUR', ?, ?, ?, 'BOOK', ?, ?, ?, '{}')`);
  for (const t of txs) {
    insert.run(`t${++seq}`, t.date, t.date, t.cents, t.who ?? null, t.iban ?? null, t.desc ?? null,
      t.category ?? null, t.category ? 'manual' : null, t.oneOff ? 1 : 0);
  }
}

// Every month from `from` to `to` (inclusive), as 'YYYY-MM'.
export function monthsBetween(from, to) {
  const out = [];
  for (let [y, m] = from.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? (y++, m = 1) : m++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}
