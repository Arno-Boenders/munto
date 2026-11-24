// Sinking funds: a pot that keeps what's left over, so a big month draws from earlier months.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthsBetween, setup } from './fixture.js';
import { budgetIn, paydaysUntil, readiness, runFund } from '../src/funds.js';

const txs = [
  { date: '2026-09-12', cents: -30000, who: 'RYANAIR', category: 'Travel' }, // the trip
  { date: '2026-10-03', cents: -2000, who: 'NMBS', category: 'Travel' },
  // Health: €10 a month of everyday spending, and the yearly gym paid this month.
  ...monthsBetween('2026-04', '2026-09').map((m) => ({ date: `${m}-05`, cents: -1000, who: 'DECATHLON', category: 'Health' })),
  { date: '2026-10-13', cents: -10000, who: 'GYM CLUB', category: 'Health' },
];
const { api, setConfig } = await setup({
  today: '2026-10-16',
  config: {
    income: { salary: [], paydayFromDay: 0, expectedMonthlyCents: null },
    budgets: { Travel: 10000, Health: 2000 },
    funds: {
      Travel: { since: '2026-07', startCents: 5000, history: [{ from: '2026-07', cents: 10000 }] },
      Health: { since: '2026-10', startCents: 8000, history: [{ from: '2026-10', cents: 2000 }] },
    },
    subscriptions: [{ id: 'gym', name: 'Gym', amountCents: 10000, every: 'year', match: 'gym club', category: 'Health' }],
  },
  txs,
});
const fund = (c) => api.funds().find((f) => f.category === c);

test('what is left over each month stays, and a big month draws from it', () => {
  const travel = fund('Travel');
  assert.deepEqual(travel.months.map((m) => [m.month, m.carried, m.spent, m.fromFund, m.balance]), [
    ['2026-07', 5000, 0, 0, 15000],
    ['2026-08', 15000, 0, 0, 25000],
    ['2026-09', 25000, 30000, 20000, 5000],
    ['2026-10', 5000, 2000, 0, 13000],
  ]);
  assert.equal(travel.balance, 13000);
});

test('the Overview card knows what the fund paid, and Left minus the funds is what is free', () => {
  const sep = api.overview('2026-09');
  const travel = sep.pots.find((e) => e.category === 'Travel');
  assert.deepEqual(travel.fund, { carried: 25000, spent: 30000, fromFund: 20000, balance: 5000 });
  assert.equal(sep.totals.kept, 10000 - 30000, 'September took €200 out of the fund');
  const oct = api.overview('2026-10');
  assert.equal(oct.totals.kept, (10000 - 2000) + (2000 - 10000));
  assert.equal(api.overview('2026-06').totals.kept, null, 'before any fund started');
});

test('a new budget counts from the month it changed, not before', () => {
  const history = [{ from: '2026-07', cents: 10000 }, { from: '2026-10', cents: 12000 }];
  assert.equal(budgetIn(history, '2026-06'), 10000);
  assert.equal(budgetIn(history, '2026-09'), 10000);
  assert.equal(budgetIn(history, '2026-11'), 12000);
  const run = runFund({ months: ['2026-09', '2026-10'], spent: { '2026-10': 2000 }, history, startCents: 0 });
  assert.deepEqual(run.map((r) => r.balance), [10000, 20000]);
});

test('spending more than the fund holds leaves it short, and it only pays what it had', () => {
  const run = runFund({ months: ['2026-10'], spent: { '2026-10': 25000 }, history: [{ from: '2026-10', cents: 5000 }], startCents: 8000 });
  assert.deepEqual([run[0].fromFund, run[0].balance], [8000, -12000]);
});

test('a yearly cost coming up: will the fund hold enough by then?', () => {
  const gym = fund('Health').upcoming[0];
  assert.equal(gym.name, 'Gym');
  assert.equal(gym.date, '2027-10-13');
  assert.equal(gym.paydays, 12, 'Nov 1 up to Oct 1');
  assert.equal(gym.expected, 0 + 12 * (2000 - 1000) - 10000);
  assert.ok(gym.ready);
  const tight = readiness({ balance: 0, budget: 1800, everyday: 1000, upcoming: [{ cents: 10000, date: '2027-10-13' }], payday: '2026-10-01', today: '2026-10-16' });
  assert.deepEqual([tight[0].expected, tight[0].ready], [-400, false]);
  assert.equal(paydaysUntil('2026-09-24', '2026-10-16', '2026-11-23'), 1, 'only the 24 October payday');
});

test('making a fund from the Budget page, and changing its budget later', async () => {
  setConfig({ budgets: {}, funds: {} });
  await assert.rejects(api.api('POST', '/api/funds', null, { category: 'Leisure' }), /monthly budget first/);
  await api.api('POST', '/api/funds', null, { category: 'Leisure', budgetCents: 6000, startCents: 15000 });
  const leisure = fund('Leisure');
  assert.deepEqual([leisure.since, leisure.startCents, leisure.budget, leisure.balance], ['2026-10', 15000, 6000, 21000]);
  await api.api('POST', '/api/budget', null, { budgets: { Leisure: 7000 } });
  assert.equal(fund('Leisure').budget, 7000);
  await api.api('POST', '/api/funds', null, { category: 'Leisure', stop: true });
  assert.equal(fund('Leisure'), undefined);
  assert.equal(api.budget().pots.find((e) => e.category === 'Leisure').budget, 7000, 'the budget stays');
});

test('a fund started mid-month only pays for what comes after', () => {
  setConfig({ budgets: { Health: 2000 }, funds: { Health: { since: '2026-10', startDate: '2026-10-14', startCents: 0, history: [{ from: '2026-10', cents: 2000 }] } } });
  const health = fund('Health');
  assert.equal(health.balance, 2000, 'the gym on 13 October was before the fund');
  assert.equal(health.upcoming[0].expected, 2000 + 12 * (2000 - 1000) - 10000, 'everyday spending still counts every month');
});
