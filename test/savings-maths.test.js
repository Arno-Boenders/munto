import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceNow, extraNeeded, monthlyDeposit, monthlyRate, monthsToGoal, project } from '../lib/savings.js';

const today = '2026-10-16';
// A savings account with €1.000 today and €100 a month going in.
const pot = (plan = {}, extra = {}) => ({
  key: 'BE00SAV', net: 0, average: 0, byMonth: {}, suggestedReturn: 0,
  plan: { mode: 'fixed', monthlyCents: 10000, annualReturn: 0, balanceCents: 100000, balanceDate: today, ...plan },
  ...extra,
});

test('a yearly return compounds to the right monthly rate', () => {
  assert.ok(Math.abs(monthlyRate(0.06) - 0.004868) < 1e-6);
  assert.ok(Math.abs((1 + monthlyRate(0.06)) ** 12 - 1.06) < 1e-12);
  assert.equal(monthlyRate(0), 0);
});

test('without interest, the projection is the balance plus the deposits', () => {
  const path = project([pot()], 12, { today });
  assert.equal(path[0].mid, 100000);
  assert.equal(path[12].mid, 100000 + 12 * 10000);
  assert.equal(path[12].deposited, 220000);
});

test('with interest, every month grows first and then gets the deposit', () => {
  const path = project([pot({ annualReturn: 0.12 })], 1, { today });
  assert.equal(path[1].mid, Math.round(100000 * (1 + monthlyRate(0.12)) + 10000));
  assert.ok(path[1].low < path[1].mid && path[1].mid < path[1].high, 'the band spreads around the expected value');
});

test('inflation shows the future in today’s money', () => {
  const path = project([pot()], 12, { today, inflation: 0.02 });
  assert.equal(path[12].mid, Math.round(220000 / 1.02));
});

test('a plan that is off adds nothing; an average plan uses the past average', () => {
  assert.equal(monthlyDeposit(pot({ mode: 'off' })), 0);
  assert.equal(monthlyDeposit(pot({ mode: 'average' }, { average: 4200 })), 4200);
  assert.equal(monthlyDeposit(pot({ mode: 'average' }, { average: -900 })), 0, 'taking money out is not a negative plan');
  assert.deepEqual(project([pot({ mode: 'off' })], 6, { today }).at(-1).mid, 0);
});

test('the balance today adds what moved after the day you typed it in', () => {
  const p = pot({ balanceDate: '2026-08-15' }, { byMonth: { '2026-08': 5000, '2026-09': 10000, '2026-10': 10000 } });
  assert.deepEqual(balanceNow(p, today), { cents: 120000, known: true });
  const unknown = pot({ balanceCents: null }, { net: 34000 });
  assert.deepEqual(balanceNow(unknown, today), { cents: 34000, known: false });
});

test('a goal is reached in the first month the plan gets there', () => {
  assert.equal(monthsToGoal([pot()], 150000, { today }), 5);
  assert.equal(monthsToGoal([pot()], 100000, { today }), 0);
  assert.equal(monthsToGoal([pot({ monthlyCents: 0 })], 150000, { today, max: 24 }), null);
});

test('the extra needed for a goal is exact, rounded up to whole euros', () => {
  // €1.000 + 12 × (€100 + extra) = €3.400 → extra = €100 exactly.
  assert.equal(extraNeeded([pot()], 340000, 12, { today }), 10000);
  assert.equal(extraNeeded([pot()], 340050, 12, { today }), 10100, 'half a euro short rounds up');
  assert.equal(extraNeeded([pot()], 200000, 12, { today }), 0, 'already on track');
});
