// The Budget page: what kind of spending each pot is, the suggestion without AI, and the 50/30/20 split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthsBetween, setup } from './fixture.js';
import { fitToRule } from '../lib/budget.js';

const SAVINGS_IBAN = 'BE22000000000022';
const months = monthsBetween('2026-04', '2026-09'); // the 6 finished calendar months
const eatingOut = [15000, 30000, 25000, 35000, 20000, 30000];
const txs = [];
months.forEach((m, i) => {
  txs.push({ date: `${m}-01`, cents: -80000, who: 'LANDLORD', category: 'Housing' });
  txs.push({ date: `${m}-12`, cents: -eatingOut[i], who: 'PIZZERIA', category: 'Eating out' });
  txs.push({ date: `${m}-15`, cents: -30000, who: 'Me', iban: SAVINGS_IBAN, category: 'Savings & transfers' });
});
txs.push({ date: '2026-07-20', cents: -120000, who: 'RYANAIR', category: 'Travel' });
txs.push({ date: '2026-05-20', cents: 40000, who: 'Me', iban: SAVINGS_IBAN, category: 'Savings & transfers' }); // took some back
txs.push({ date: '2026-10-05', cents: -9000, who: 'PIZZERIA', category: 'Eating out' }); // this month, not finished

const { api } = await setup({
  today: '2026-10-16',
  config: { income: { salary: [], paydayFromDay: 0, expectedMonthlyCents: 200000 }, ownIbans: [SAVINGS_IBAN] },
  txs,
});
const data = api.budget();
const pot = (c) => data.pots.find((e) => e.category === c);

test('it looks at the last 6 finished months, oldest first', () => {
  assert.deepEqual(data.months, months);
  assert.equal(data.income, 200000);
  assert.deepEqual(pot('Eating out').months, eatingOut);
});

test('each pot gets a kind and a plain suggestion', () => {
  assert.deepEqual([pot('Housing').kind, pot('Housing').plain], ['fixed', 80000]); // the latest amount
  assert.deepEqual([pot('Eating out').kind, pot('Eating out').plain], ['flexible', 28000]); // the median (€275), rounded up to €10
  assert.deepEqual([pot('Travel').kind, pot('Travel').plain], ['irregular', 20000]); // the average: a trip spread out
  assert.equal(pot('Eating out').spentNow, 9000);
});

test('savings per month add up to the savings average', () => {
  assert.deepEqual(data.savedMonths, [30000, -10000, 30000, 30000, 30000, 30000]);
  assert.equal(data.savedAverage, Math.round(data.savedMonths.reduce((a, b) => a + b, 0) / 6));
});

const groups = { Housing: 'needs', 'Eating out': 'wants', Travel: 'wants' };
const others = (out) => Object.fromEntries(Object.entries(out).filter(([c]) => c in groups));

test('a budget that already fits the rule is left alone', () => {
  const out = others(fitToRule(data, groups, '50-30-20'));
  assert.deepEqual(Object.fromEntries(Object.entries(out).map(([c, v]) => [c, v.cents])), { Housing: 80000, 'Eating out': 28000, Travel: 20000 });
});

test('wants over their share are trimmed evenly to fit, fixed costs never', () => {
  const tight = { ...data, income: 100000 }; // wants may take 30% = €300
  const out = fitToRule(tight, groups, '50-30-20');
  assert.equal(out.Housing.cents, 80000, 'rent is fixed: it stays, even over the 50%');
  const wants = out['Eating out'].cents + out.Travel.cents;
  assert.ok(wants <= 30000, `wants ${wants} fit in €300`);
  assert.ok(wants >= 29000, 'and use most of it');
  assert.equal(out['Eating out'].cents % 500, 0, 'rounded to €5');
  assert.match(out['Eating out'].reason, /−38% to fit/);
});

