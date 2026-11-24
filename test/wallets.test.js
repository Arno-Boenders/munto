// PayPal: each payment shows up in PayPal (with the merchant) and at the bank ("PayPal Europe"). Counted once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYPAL, addTxs, setup } from './fixture.js';

const SAVINGS_IBAN = 'BE22000000000022';
const bankPaypal = (date, cents) => ({ date, cents, ...PAYPAL });
const { api, db } = await setup({
  today: '2026-10-16',
  config: { income: { salary: [], paydayFromDay: 0, expectedMonthlyCents: null }, ownIbans: [SAVINGS_IBAN] },
  txs: [
    bankPaypal('2026-09-22', -1000), // Streamly
    bankPaypal('2026-09-29', -1200), // CloudCo, $13,00 at PayPal
    bankPaypal('2026-08-05', -4500), bankPaypal('2026-08-05', 4500), // charged and refunded
    bankPaypal('2026-03-10', -2500), // before PayPal's history: stays
    { date: '2026-09-15', cents: -30000, who: 'Me', iban: SAVINGS_IBAN, category: 'Savings & transfers' },
  ],
});
db.exec("INSERT INTO sessions (id, bank, valid_until) VALUES ('s2', 'PayPal', '2099-01-01')");
db.exec("INSERT INTO accounts (uid, session_id, bank, iban, name, currency) VALUES ('pp', 's2', 'PayPal', NULL, 'Me', 'XXX')");
const wallet = [
  ['w1', '2026-09-20', -1000, 'EUR', 'Streamly AB', 'Subscriptions'],
  ['w2', '2026-09-27', -1300, 'USD', 'CloudCo Inc', 'Subscriptions'],
  ['w3', '2026-08-04', -4500, 'EUR', 'App Store', 'Leisure'],
  ['w4', '2026-08-05', 4500, 'EUR', 'App Store', 'Leisure'],
];
const ins = db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, amount_cents, currency, counterparty, status, category, category_source, raw)
  VALUES (?, 'pp', ?, ?, ?, ?, 'BOOK', ?, 'manual', '{}')`);
for (const w of wallet) ins.run(...w);
// Imported only now: wallets.js opens the database, which must be the test one.
const { linkWallets, matchWallet } = await import('../src/wallets.js');

test('matched by amount and date; another currency by what the bank took', () => {
  const pairs = matchWallet(
    [{ id: 'a', date: '2026-09-20', cents: -1000, currency: 'EUR' }, { id: 'b', date: '2026-09-27', cents: -1300, currency: 'USD' }],
    [{ id: 'x', date: '2026-09-29', cents: -1200 }, { id: 'y', date: '2026-09-22', cents: -1000 }, { id: 'z', date: '2026-10-20', cents: -1000 }],
  );
  assert.deepEqual(pairs.map((p) => [p.wallet, p.bank, p.cents]), [['a', 'y', -1000], ['b', 'x', -1200]]);
});

test('the same amount twice: each bank payment matches once, the closest date first', () => {
  const pairs = matchWallet(
    [{ id: 'a', date: '2026-09-01', cents: -299, currency: 'EUR' }, { id: 'b', date: '2026-10-01', cents: -299, currency: 'EUR' }],
    [{ id: 'x', date: '2026-10-03', cents: -299 }, { id: 'y', date: '2026-09-03', cents: -299 }],
  );
  assert.deepEqual(pairs.map((p) => [p.wallet, p.bank]), [['a', 'y'], ['b', 'x']]);
});

test('after the sync, every PayPal payment counts once, as the merchant', () => {
  assert.equal(linkWallets(), 4);
  assert.equal(linkWallets(), 0, 'running it again changes nothing');
  const sep = api.overview('2026-09');
  assert.equal(sep.totals.spent, 1000 + 1200, 'Streamly and CloudCo, not twice');
  assert.equal(sep.totals.saved, 30000, 'moving money to PayPal is not saving');
  assert.ok(!sep.pots.some((e) => e.category === null), 'nothing left unsorted');
  const cf = db.prepare("SELECT amount_cents, currency FROM transactions WHERE id = 'w2'").get();
  assert.deepEqual({ ...cf }, { amount_cents: -1200, currency: 'EUR' });
  const aug = api.overview('2026-08');
  assert.equal(aug.totals.spent, 0, 'charged and refunded');
  const march = db.prepare("SELECT category_source FROM transactions WHERE booking_date = '2026-03-10'").get();
  assert.notEqual(march.category_source, 'mirror', 'before PayPal history: still the bank payment');
});

test('a mirror whose PayPal transaction disappears counts again', () => {
  db.prepare("DELETE FROM transactions WHERE id = 'w1'").run();
  linkWallets();
  const streamly = db.prepare("SELECT category_source, mirror_of FROM transactions WHERE booking_date = '2026-09-22'").get();
  assert.deepEqual({ ...streamly }, { category_source: null, mirror_of: null });
});

test('only payments to PayPal itself are candidates, not a description that mentions it', () => {
  addTxs(db, [{ date: '2026-09-21', cents: -4200, who: 'DOE JANE', desc: 'paid back for a paypal purchase' }]);
  ins.run('w5', '2026-09-20', -4200, 'EUR', 'Some shop', 'Shopping');
  linkWallets();
  const friend = db.prepare("SELECT category_source FROM transactions WHERE counterparty = 'DOE JANE'").get();
  assert.notEqual(friend.category_source, 'mirror');
});
