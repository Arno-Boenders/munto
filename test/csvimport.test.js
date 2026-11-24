// CSV import: any bank's export, read without knowing the bank. All data here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixture.js';

const { api, db } = await setup({ today: '2026-11-18' });
const csv = await import('../src/csvimport.js');
const { saveSession } = await import('../src/linking.js');

// Dutch columns, a line of account details above the header, semicolons, decimal commas, day-first dates.
const DUTCH = [
  'Rekening;BE00 0000 0000 0001;Zichtrekening',
  'Rekeningnummer;Boekingsdatum;Bedrag;Munt;Naam tegenpartij;Rekening tegenpartij;Omschrijving;Mededeling',
  'BE00 0000 0000 0001;02/11/2026;-12,34;EUR;Bakery;BE00 0000 0000 0002;Kaartbetaling;"brood; koffie"',
  'BE00 0000 0000 0001;03/11/2026;1.250,00;EUR;Employer Ltd;BE00 0000 0000 0003;Overschrijving;Loon',
  'BE00 0000 0000 0001;03/11/2026;-3,50;EUR;Bakery;;Kaartbetaling;',
  'BE00 0000 0000 0001;03/11/2026;-3,50;EUR;Bakery;;Kaartbetaling;',
  'BE00 0000 0000 0001;;-1,00;EUR;No date;;;',
].join('\r\n');

test('amounts the way banks write them', () => {
  const cases = { '-12,34': -1234, '1.250,00': 125000, '1,234.56': 123456, '€ 12.30': 1230, '12,30-': -1230, '(5,00)': -500,
    '+7': 700, '1.234': 123400, '0,5': 50, "1'234.50": 123450, '': NaN, 'abc': NaN, '12,345,67': NaN };
  for (const [text, cents] of Object.entries(cases)) assert.equal(csv.parseAmount(text), cents, text);
});

test('the date format is the one every date fits, day first before month first', () => {
  assert.equal(csv.dateFormat(['2026-11-02', '2026-11-30']), 'ymd');
  assert.equal(csv.dateFormat(['02/11/2026', '30/11/2026']), 'dmy');
  assert.equal(csv.dateFormat(['11/30/2026', '11/02/2026']), 'mdy');
  assert.equal(csv.dateFormat(['02.11.26']), 'dmy');
  assert.equal(csv.dateFormat(['nonsense']), null);
});

test('quotes, the separator and the header under a few lines of account details', () => {
  const { sep, rows } = csv.parseCsv(`﻿${DUTCH}`);
  assert.equal(sep, ';');
  const { header, body } = csv.splitHeader(rows);
  assert.equal(header[1], 'Boekingsdatum');
  assert.equal(body[0][7], 'brood; koffie');
  assert.equal(body.length, 5);
});

test('columns are guessed from their names, in Dutch, French and English', () => {
  assert.deepEqual(csv.guessMapping(['Rekeningnummer', 'Boekingsdatum', 'Bedrag', 'Munt', 'Naam tegenpartij', 'Rekening tegenpartij', 'Omschrijving', 'Mededeling']),
    { account: 0, date: 1, amount: 2, currency: 3, counterparty: 4, counterpartyIban: 5, description: 6, description2: 7 });
  assert.deepEqual(csv.guessMapping(['Date d\'exécution', 'Montant', 'Devise', 'Contrepartie', 'Compte de la contrepartie', 'Communication']),
    { date: 0, amount: 1, currency: 2, counterparty: 3, counterpartyIban: 4, description: 5 });
  assert.deepEqual(csv.guessMapping(['Date', 'Description', 'Money out', 'Money in']), { date: 0, description: 1, debit: 2, credit: 3 });
});

test('money out and money in as two columns', () => {
  const { txs } = csv.toTransactions(['Date', 'Payee', 'Money out', 'Money in'],
    [['2026-11-02', 'Bakery', '12.34', ''], ['2026-11-03', 'Employer Ltd', '', '1250.00']], { date: 0, counterparty: 1, debit: 2, credit: 3 });
  assert.deepEqual(txs.map((t) => t.cents), [-1234, 125000]);
});

test('the preview: what would be imported, and the rows that can’t be', () => {
  const p = csv.preview(DUTCH);
  assert.equal(p.count, 4);
  assert.equal(p.problemCount, 1);
  assert.deepEqual(p.problems[0], { row: 5, reason: 'no date' });
  assert.deepEqual([p.from, p.to, p.iban], ['2026-11-02', '2026-11-03', 'BE00000000000001']);
  assert.deepEqual(p.sample[0], { date: '2026-11-02', cents: -1234, currency: 'EUR', counterparty: 'Bakery', counterpartyIban: 'BE00000000000002', description: 'Kaartbetaling brood; koffie' });
  assert.throws(() => csv.preview('just one line'), /CSV export/);
});

const count = (uid) => db.prepare('SELECT count(*) AS n FROM transactions WHERE account_uid = ?').get(uid).n;

test('importing makes an account; the same or an overlapping export again only adds what’s new', () => {
  const first = csv.importCsv({ text: DUTCH, name: 'Current account', bank: 'Bank A' });
  assert.match(first.uid, /^csv-/);
  assert.deepEqual([first.added, first.already, first.skipped], [4, 0, 1]);
  assert.equal(count(first.uid), 4, 'two identical payments on one day are both kept');
  const again = csv.importCsv({ text: DUTCH, name: 'Current account', bank: 'Bank A' });
  assert.deepEqual([again.uid, again.added, again.already], [first.uid, 0, 4]);
  const later = `${DUTCH}\nBE00 0000 0000 0001;04/11/2026;-8,00;EUR;Grocer;;Kaartbetaling;`;
  assert.equal(csv.importCsv({ text: later, name: 'Current account', bank: 'Bank A' }).added, 1);
  // The columns are remembered for this header.
  assert.equal(csv.preview(DUTCH).remembered, true);
});

test('imported accounts are never synced, reminded about or taken over by linking', () => {
  assert.ok(!api.bankAccess().some((a) => a.bank === 'Bank A'));
  const uid = db.prepare("SELECT uid FROM accounts WHERE uid LIKE 'csv-%'").get().uid;
  // Linking the same bank and IBAN through Enable Banking: a new account, the CSV one stays.
  saveSession({ session_id: 'eb-1', accounts: [{ uid: 'eb-acc', account_id: { iban: 'BE00 0000 0000 0001' }, currency: 'EUR' }] }, 'Bank A', '2099-01-01');
  assert.equal(count(uid), 5);
  assert.ok(db.prepare("SELECT 1 FROM accounts WHERE uid = 'eb-acc'").get());
});

test('once the bank has the same account, its transactions take over from its first day', () => {
  const uid = db.prepare("SELECT uid FROM accounts WHERE uid LIKE 'csv-%'").get().uid;
  // A wrong, very old date from the bank, or one it hasn't booked: neither takes the CSV history away.
  db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, amount_cents, currency, status, raw)
    VALUES ('eb-acc:old', 'eb-acc', '1970-01-01', -100, 'EUR', 'BOOK', '{}'), ('eb-acc:p', 'eb-acc', '2026-11-01', -100, 'EUR', 'PDNG', '{}')`).run();
  assert.equal(csv.dropCsvOverlap(), 0);
  assert.equal(count(uid), 5);
  db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, amount_cents, currency, status, raw)
    VALUES ('eb-acc:1', 'eb-acc', '2026-11-03', -350, 'EUR', 'BOOK', '{}'), ('eb-acc:2', 'eb-acc', '2026-11-04', -800, 'EUR', 'BOOK', '{}')`).run();
  assert.equal(csv.dropCsvOverlap(), 4, 'the CSV rows from 3 to 4 November, the days the bank has');
  assert.deepEqual(db.prepare('SELECT booking_date FROM transactions WHERE account_uid = ?').all(uid).map((r) => r.booking_date), ['2026-11-02']);
});

test('the bank covers a day between its own first and last day of that month', () => {
  const span = csv.bankDaysPerMonth(['1970-01-01', '2024-03-20', '2024-03-02', '2026-11-03', '2026-11-10']);
  assert.deepEqual(span, { '1970-01': ['1970-01-01', '1970-01-01'], '2024-03': ['2024-03-02', '2024-03-20'], '2026-11': ['2026-11-03', '2026-11-10'] });
  assert.equal(csv.coveredByBank('2026-11-02', span), false, 'before the bank’s first day that month');
  assert.equal(csv.coveredByBank('2026-11-03', span), true);
  assert.equal(csv.coveredByBank('2026-11-10', span), true);
  assert.equal(csv.coveredByBank('2026-11-20', span), false, 'after the bank’s last day that month (access that ended)');
  assert.equal(csv.coveredByBank('2024-03-15', span), true, 'years back, month by month');
  assert.equal(csv.coveredByBank('2025-06-01', span), false, 'a month the bank has nothing for');
  assert.equal(csv.coveredByBank('1970-01-02', span), false, 'a stray old date speaks only for its own day');
});

test('only booked bank transactions count: not pending ones, nor ones without a status', () => {
  const imported = csv.importCsv({ text: `Date;Amount;IBAN\n2026-10-05;-1,00;BE00 0000 0000 0009\n2026-10-20;-2,00;BE00 0000 0000 0009`,
    mapping: { date: 0, amount: 1, account: 2 }, name: 'Other', bank: 'Bank B' });
  saveSession({ session_id: 'eb-9', accounts: [{ uid: 'eb-9a', account_id: { iban: 'BE00 0000 0000 0009' }, currency: 'EUR' }] }, 'Bank B', '2099-01-01');
  db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, amount_cents, currency, status, raw)
    VALUES ('eb-9a:1', 'eb-9a', '2026-10-01', -100, 'EUR', 'PDNG', '{}'), ('eb-9a:2', 'eb-9a', '2026-10-31', -100, 'EUR', NULL, '{}')`).run();
  assert.equal(csv.dropCsvOverlap(), 0);
  db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, amount_cents, currency, status, raw)
    VALUES ('eb-9a:3', 'eb-9a', '2026-10-10', -100, 'EUR', 'BOOK', '{}'), ('eb-9a:4', 'eb-9a', '2026-10-25', -100, 'EUR', 'BOOK', '{}')`).run();
  assert.equal(csv.dropCsvOverlap(), 1, 'the 20 October row; 5 October is before the bank’s first booked day');
  assert.equal(count(imported.uid), 1);
  csv.removeCsvAccount(imported.uid);
});

test('removing an imported account, and only an imported one', () => {
  const uid = db.prepare("SELECT uid FROM accounts WHERE uid LIKE 'csv-%'").get().uid;
  assert.throws(() => csv.removeCsvAccount('eb-acc'), /Only imported accounts/);
  assert.deepEqual(csv.removeCsvAccount(uid), { removed: 1 });
  assert.equal(db.prepare('SELECT count(*) AS n FROM accounts WHERE uid = ?').get(uid).n, 0);
});

test('your IBAN counts only when every row has the same one', () => {
  const header = ['Date', 'Amount', 'IBAN'];
  const mixed = [['2026-11-02', '-1', 'BE00 0000 0000 0001'], ['2026-11-03', '-2', 'BE00 0000 0000 0002']];
  assert.equal(csv.toTransactions(header, mixed, { date: 0, amount: 1, account: 2 }).iban, null, 'other people’s IBANs, guessed wrong');
  const same = [['2026-11-02', '-1', 'BE00 0000 0000 0001'], ['2026-11-03', '-2', 'be00000000000001'], ['2026-11-04', '-3', '']];
  assert.equal(csv.toTransactions(header, same, { date: 0, amount: 1, account: 2 }).iban, 'BE00000000000001');
});

test('only an account an import made can be removed, whatever its id looks like', () => {
  db.exec("INSERT INTO sessions (id, bank, valid_until) VALUES ('other-session', 'Bank A', '2099-01-01')");
  db.exec("INSERT INTO accounts (uid, session_id, bank, currency) VALUES ('csv-lookalike', 'other-session', 'Bank A', 'EUR')");
  assert.throws(() => csv.removeCsvAccount('csv-lookalike'), /Only imported accounts/);
  assert.ok(db.prepare("SELECT 1 FROM accounts WHERE uid = 'csv-lookalike'").get());
  assert.throws(() => saveSession({ session_id: 'eb-2', accounts: [{ uid: 'csv-1234', currency: 'EUR' }] }, 'Bank A', '2099-01-01'), /can’t use|can't use/);
  // Nor a session id of Munto's own: removing the sample data would then take the bank's accounts along.
  for (const id of ['sample-session', 'csv-abc', '', undefined]) {
    assert.throws(() => saveSession({ session_id: id, accounts: [{ uid: 'eb-3', currency: 'EUR' }] }, 'Bank A', '2099-01-01'), /can’t use|can't use/, String(id));
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM accounts WHERE uid = 'eb-3'").get().n, 0);
});

test('an import needs a name, a bank, a date and an amount', () => {
  assert.throws(() => csv.importCsv({ text: DUTCH, name: '', bank: 'Bank A' }), /name/);
  assert.throws(() => csv.importCsv({ text: DUTCH, name: 'X', bank: 'Bank A', mapping: { date: 1 } }), /date and the amount/);
});
