// Looking back at last month: judged by the budget it had then; raise, keep or lower, and remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthsBetween, setup } from './fixture.js';

const txs = [
  ...[['2026-07', 22000], ['2026-08', 21000], ['2026-09', 25300]].map(([m, c]) => ({ date: `${m}-10`, cents: -c, who: 'PIZZERIA', category: 'Eating out' })),
  ...monthsBetween('2026-07', '2026-09').map((m) => ({ date: `${m}-05`, cents: -20000, who: 'DELHAIZE', category: 'Groceries' })),
  { date: '2026-09-15', cents: -9000, who: 'NMBS', category: 'Transport' },
  ...[['2026-07', 5000], ['2026-08', 6000], ['2026-09', 30000]].map(([m, c]) => ({ date: `${m}-12`, cents: -c, who: 'KINEPOLIS', category: 'Leisure' })),
  { date: '2026-09-20', cents: -6000, who: 'ZARA', category: 'Shopping' },
];
const { api, setConfig } = await setup({
  today: '2026-10-16',
  config: {
    income: { salary: [], paydayFromDay: 0, expectedMonthlyCents: null },
    budgets: { 'Eating out': 20000, Groceries: 40000, Transport: 10000, Shopping: 8000, Leisure: 10000 },
    // Shopping was €50 in September and raised to €80 this month.
    budgetHistory: { Shopping: [{ from: '0000-00', cents: 5000 }, { from: '2026-10', cents: 8000 }] },
  },
  txs,
});
const pot = (c) => api.lookback().pots.find((e) => e.category === c);

test('it looks back at the month that just ended', () => {
  const lb = api.lookback();
  assert.equal(lb.month, '2026-09');
  assert.equal(lb.done, false);
  assert.equal(lb.pots[0].category, 'Leisure', 'the most over first');
});

test('over most months: raise it to what was enough in 2 of every 3', () => {
  const e = pot('Eating out');
  assert.deepEqual([e.status, e.budget, e.spent, e.suggestion, e.overCount], ['over', 20000, 25300, 22000, 3]);
});

test('over once, after months well within: a one-off, so no raise', () => {
  const e = pot('Leisure');
  assert.deepEqual([e.status, e.overCount, e.suggestion], ['over', 1, null]);
});

test('well under three months running: lower it to just above the highest of them', () => {
  const e = pot('Groceries');
  assert.deepEqual([e.status, e.suggestion], ['slack', 20000]);
  assert.equal(pot('Transport').status, 'within');
});

test('judged by the budget it had then, and already raised since: nothing to decide', () => {
  const e = pot('Shopping');
  assert.deepEqual([e.budget, e.status, e.now, e.decision], [5000, 'over', 8000, 'changed']);
  assert.equal(api.lookback().open, 2, 'Eating out and Groceries');
});

test('a new budget counts from this month on; earlier months keep theirs', async () => {
  await api.api('POST', '/api/budget', null, { budgets: { Transport: 12000 } });
  assert.equal(pot('Transport').budget, 10000);
  assert.equal(pot('Transport').now, 12000);
  assert.equal(api.budget().pots.find((e) => e.category === 'Transport').budget, 12000);
});

test('raise, keep, lower, and putting the month away', async () => {
  await api.api('POST', '/api/lookback', null, { month: '2026-09', category: 'Eating out', action: 'raise', cents: 22000 });
  assert.deepEqual([pot('Eating out').decision, pot('Eating out').now, pot('Eating out').budget], ['raised', 22000, 20000]);
  await api.api('POST', '/api/lookback', null, { month: '2026-09', category: 'Groceries', action: 'keep' });
  assert.equal(pot('Groceries').decision, 'kept');
  assert.equal(pot('Groceries').now, 40000);
  assert.equal(api.lookback().open, 0);
  await api.api('POST', '/api/lookback', null, { month: '2026-09', action: 'done' });
  assert.equal(api.lookback().done, true);
});

test('a fund never goes over: it shows what it kept or paid', () => {
  setConfig({
    budgets: { Travel: 10000 }, budgetHistory: {},
    funds: { Travel: { since: '2026-08', startCents: 30000, history: [{ from: '2026-08', cents: 10000 }] } },
  });
  const e = pot('Travel');
  assert.equal(e.status, 'fund');
  assert.deepEqual(e.fund, { kept: 10000, fromFund: 0, balance: 50000 });
});

test('no budgets, no look back', () => {
  setConfig({ budgets: {}, funds: {} });
  assert.equal(api.lookback(), null);
});
