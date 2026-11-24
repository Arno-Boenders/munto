// Months run from payday to payday, and every amount on the Overview depends on getting them right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixture.js';

const SAVINGS_IBAN = 'BE22000000000022';
const { api, setConfig } = await setup({
  today: '2026-10-16',
  config: { income: { salary: ['ACME'], paydayFromDay: 20, expectedMonthlyCents: null }, ownIbans: [SAVINGS_IBAN] },
  txs: [
    { date: '2026-07-01', cents: -4000, who: 'DELHAIZE', category: 'Groceries' },
    // Salary from ACME around the 24th.
    { date: '2026-07-24', cents: 250000, who: 'ACME', category: 'Income' },
    { date: '2026-08-25', cents: 250000, who: 'ACME', category: 'Income' },
    { date: '2026-09-24', cents: 250000, who: 'ACME', category: 'Income' },
    // Bigger, after the 20th, but not from the salary payer: must not start September.
    { date: '2026-08-22', cents: 300000, who: 'MOM', category: 'Income' },
    // A bonus marked one-off: must not start October either.
    { date: '2026-09-28', cents: 500000, who: 'ACME', category: 'Income', oneOff: true },
    // September (25 Aug – 23 Sep): groceries with a refund, eating out, and money put into savings.
    { date: '2026-09-01', cents: -10000, who: 'DELHAIZE', category: 'Groceries' },
    { date: '2026-09-05', cents: 2000, who: 'DELHAIZE', category: 'Groceries' },
    { date: '2026-09-10', cents: -5000, who: 'PIZZERIA', category: 'Eating out' },
    { date: '2026-09-15', cents: -30000, who: 'Me', iban: SAVINGS_IBAN, category: 'Savings & transfers' },
    { date: '2026-09-23', cents: -1000, who: 'PIZZERIA', category: 'Eating out' },
  ],
});

test('months run from salary to salary', () => {
  const periods = api.budgetPeriods().map(({ month, start, end, payday }) => ({ month, start, end, payday }));
  assert.deepEqual(periods, [
    { month: '2026-10', start: '2026-09-24', end: null, payday: true },
    { month: '2026-09', start: '2026-08-25', end: '2026-09-23', payday: true },
    { month: '2026-08', start: '2026-07-24', end: '2026-08-24', payday: true },
    { month: '2026-07', start: '2026-07-01', end: '2026-07-23', payday: false },
  ]);
});

test('Income − Spent − Saved = Left, with refunds lowering the pot', () => {
  const sep = api.overview('2026-09');
  assert.equal(sep.totals.income, 250000);
  assert.equal(sep.totals.spent, 10000 - 2000 + 5000 + 1000);
  assert.equal(sep.totals.paidBack, 2000);
  assert.equal(sep.totals.saved, 30000);
  assert.equal(sep.totals.left, 250000 - 14000 - 30000);
  const groceries = sep.pots.find((e) => e.category === 'Groceries');
  assert.deepEqual([groceries.out, groceries.back, groceries.net], [10000, 2000, 8000]);
  assert.ok(!sep.pots.some((e) => e.category === 'Savings & transfers'), 'savings are not spending');
});

test('a one-off still counts as income that month', () => {
  const oct = api.overview('2026-10');
  assert.equal(oct.totals.income, 750000);
  assert.equal(oct.totals.oneOff, 500000);
});

test('without a payday, months are calendar months', () => {
  setConfig({ income: { salary: [], paydayFromDay: 0, expectedMonthlyCents: null }, ownIbans: [SAVINGS_IBAN] });
  const periods = api.budgetPeriods();
  assert.deepEqual(periods.map((p) => [p.month, p.start, p.end]), [
    ['2026-10', '2026-10-01', null],
    ['2026-09', '2026-09-01', '2026-09-30'],
    ['2026-08', '2026-08-01', '2026-08-31'],
    ['2026-07', '2026-07-01', '2026-07-31'],
  ]);
});
