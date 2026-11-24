// Sorting: merchant names, rules (first match wins, direction), own accounts, and hand-sorted ones kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { setup } from './fixture.js';

const SAVINGS_IBAN = 'BE22 0000 0000 0022';
const { categories, db } = await setup({
  today: '2026-10-16',
  config: {
    ownIbans: [SAVINGS_IBAN],
    rules: [
      { match: 'delhaize', category: 'Groceries' },
      { match: 'acme', category: 'Income', direction: 'in' },
      { match: 'acme', category: 'Shopping', direction: 'out' },
      { match: 'pizz', category: 'Eating out' },
    ],
  },
  txs: [
    { date: '2026-10-01', cents: -4000, desc: 'BETALING MET DEBETKAART NUMMER 1234 56XX XXXX 1234 DELHAIZE LEUVEN 30-09-2026 OM 18.02 UUR' },
    { date: '2026-10-02', cents: 250000, who: 'ACME S.A.' },
    { date: '2026-10-03', cents: -1999, who: 'ACME NV' },
    { date: '2026-10-04', cents: -30000, who: 'Me', iban: 'be22000000000022' },
    { date: '2026-10-05', cents: -1500, who: 'PIZZERIA ROMA', category: 'Friends & gifts' }, // sorted by hand
    { date: '2026-10-06', cents: -800, who: 'UNKNOWN SHOP' },
  ],
});
const categoryOf = () => Object.fromEntries(db.prepare('SELECT booking_date, category FROM transactions').all().map((r) => [r.booking_date, r.category]));

test('merchant names group the same shop together', () => {
  const { merchantKey } = categories;
  const card = (rest) => ({ description: `BETALING MET DEBETKAART NUMMER 1234 56XX XXXX 1234 ${rest}` });
  assert.equal(merchantKey(card('CAFE EXAMPLE LEUVEN 12-08-2026 OM 21.14 UUR')), 'CAFE EXAMPLE');
  assert.equal(merchantKey(card('CAFE EXAMPLE LEUVEN 30-09-2026 OM 22.40 UUR')), 'CAFE EXAMPLE');
  assert.equal(merchantKey({ counterparty: 'ACME S.A.' }), 'ACME');
  assert.equal(merchantKey({ counterparty: 'Acme sa' }), 'ACME');
  assert.equal(merchantKey({ counterparty: 'ACME NV' }), 'ACME');
});

test('rules: first match wins, direction separates income from spending', () => {
  const result = categories.applyRules();
  const c = categoryOf();
  assert.equal(c['2026-10-01'], 'Groceries');
  assert.equal(c['2026-10-02'], 'Income');
  assert.equal(c['2026-10-03'], 'Shopping');
  assert.equal(c['2026-10-06'], null);
  assert.equal(result.uncategorised, 1);
});

test('money to your own accounts is a transfer, whatever the rules say', () => {
  categories.applyRules();
  assert.equal(categoryOf()['2026-10-04'], 'Savings & transfers');
});

test('what you sorted by hand is never overwritten by a rule', () => {
  categories.applyRules();
  assert.equal(categoryOf()['2026-10-05'], 'Friends & gifts');
});

test('a custom match must appear in every transaction it is meant for', () => {
  const txs = [{ counterparty: 'STREAMLY AB', description: 'x' }, { counterparty: 'Streamly', description: 'y' }];
  assert.ok(categories.matchesAll('streamly', txs));
  assert.ok(!categories.matchesAll('streamly ab', txs));
  assert.ok(!categories.matchesAll('st', txs), 'too short to be safe');
});

test('a subscription sorts its own payments first; the rest of that merchant is left to the rules', () => {
  db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, value_date, amount_cents, currency, counterparty, status, raw)
    VALUES (?, 'a1', ?, ?, ?, 'EUR', 'App Store', 'BOOK', '{}')`).run('ap1', '2026-09-06', '2026-09-06', -200);
  db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, value_date, amount_cents, currency, counterparty, status, raw)
    VALUES (?, 'a1', ?, ?, ?, 'EUR', 'App Store', 'BOOK', '{}')`).run('ap2', '2026-09-14', '2026-09-14', -1500);
  db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, value_date, amount_cents, currency, counterparty, status, raw)
    VALUES (?, 'a1', ?, ?, ?, 'EUR', 'App Store', 'BOOK', '{}')`).run('ap3', '2026-09-20', '2026-09-20', -200);
  const config = JSON.parse(readFileSync(process.env.CONFIG_PATH, 'utf8'));
  config.subscriptions = [{ id: 'cloud', name: 'Cloud Storage', amountCents: 200, every: 'month', match: 'app store', byAmount: true, day: 6, category: 'Subscriptions' }];
  config.rules.push({ match: 'app store', category: 'Leisure' });
  writeFileSync(process.env.CONFIG_PATH, JSON.stringify(config));
  categories.applyRules();
  const c = Object.fromEntries(db.prepare("SELECT id, category FROM transactions WHERE id LIKE 'ap%'").all().map((r) => [r.id, r.category]));
  assert.deepEqual(c, { ap1: 'Subscriptions', ap2: 'Leisure', ap3: 'Leisure' }, 'the €2,00 on the 20th is an app, not Cloud Storage');
});

test('a rule with an amount only sorts payments of exactly that amount, and goes before the rules without one', () => {
  const config = JSON.parse(readFileSync(process.env.CONFIG_PATH, 'utf8'));
  config.subscriptions = [];
  config.rules.push({ match: 'app store', category: 'Subscriptions', amountCents: 200 }); // added last, still first
  writeFileSync(process.env.CONFIG_PATH, JSON.stringify(config));
  categories.applyRules();
  const c = Object.fromEntries(db.prepare("SELECT id, category FROM transactions WHERE id LIKE 'ap%'").all().map((r) => [r.id, r.category]));
  assert.deepEqual(c, { ap1: 'Subscriptions', ap2: 'Leisure', ap3: 'Subscriptions' });
});

test('a deleted rule can be put back in its old place', () => {
  const { deleteRule, restoreRule, loadConfig } = categories;
  const before = loadConfig().rules;
  const second = before[1];
  deleteRule(1);
  assert.notDeepEqual(loadConfig().rules[1], second);
  restoreRule(1, second);
  assert.deepEqual(loadConfig().rules, before);
  assert.equal(categoryOf()['2026-10-02'], 'Income', 'rules apply again after the undo');
});

test('a pot name is plain text, and a rule put back must be a valid pattern', () => {
  for (const bad of ['__proto__', 'constructor', '', '   ', 42, null, 'x'.repeat(81)]) {
    assert.throws(() => categories.checkCategory(bad), { status: 400 }, String(bad));
  }
  assert.equal(categories.checkCategory('Groceries'), 'Groceries');
  const before = categories.loadConfig().rules.length;
  assert.throws(() => categories.restoreRule(0, { match: '(', category: 'Groceries' }), { status: 400 });
  assert.equal(categories.loadConfig().rules.length, before);
});
