// Subscriptions: linking them to payments, also when one payer (PayPal) carries many different things.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYPAL, monthsBetween, setup } from './fixture.js';

const paypal = (date, cents) => ({ date, cents: -cents, ...PAYPAL, category: 'Subscriptions' });
const txs = [
  // Streamly €10,00 around the 22nd, plus one unrelated €10,00 on 1 June.
  ...['2026-04-22', '2026-05-22', '2026-06-23', '2026-07-22', '2026-08-24', '2026-09-22'].map((d) => paypal(d, 1000)),
  paypal('2026-06-01', 1000),
  // Cloud Storage €2,00 around the 8th.
  ...monthsBetween('2026-04', '2026-10').map((m) => paypal(`${m}-08`, 200)),
  // A yearly domain at €12,00, and two similar prices that are something else.
  paypal('2026-09-29', 1200), paypal('2026-07-24', 1240), paypal('2026-05-12', 1170),
  // Shopping through PayPal.
  paypal('2026-05-26', 98765), paypal('2026-07-28', 12345), paypal('2026-08-05', 4500),
  // A friend you pay now and then, sometimes the same amount: not a platform, so never split by amount.
  ...monthsBetween('2026-04', '2026-09').map((m) => ({ date: `${m}-01`, cents: -2000, who: 'DOE JANE', category: 'Friends & gifts' })),
  { date: '2026-06-14', cents: -3000, who: 'DOE JANE', category: 'Friends & gifts' },
  { date: '2026-08-19', cents: -1500, who: 'DOE JANE', category: 'Friends & gifts' },
  { date: '2026-09-09', cents: -5000, who: 'DOE JANE', category: 'Friends & gifts' },
];
const subscriptions = [
  { id: 'stream', name: 'Streamly', amountCents: 1000, every: 'month', match: 'paypal', byAmount: true, day: 22, category: 'Subscriptions' },
  { id: 'cloud', name: 'Cloud Storage', amountCents: 200, every: 'month', match: 'paypal', byAmount: false, day: null, category: 'Subscriptions' },
  { id: 'dom', name: 'Domain', amountCents: 1200, every: 'year', match: 'paypal', byAmount: true, day: null, category: 'Subscriptions' },
];
const { api, setConfig } = await setup({ today: '2026-10-16', config: { subscriptions }, txs });

test('linked by amount and day, only that subscription’s payments count', () => {
  const streamly = api.subscriptions().list.find((s) => s.id === 'stream');
  assert.deepEqual(streamly.charges.map((c) => c.date), ['2026-09-22', '2026-08-24', '2026-07-22', '2026-06-23', '2026-05-22', '2026-04-22']);
  assert.equal(streamly.lastDate, '2026-09-22');
  assert.equal(streamly.nextDate, '2026-10-22');
  assert.equal(streamly.mixed, null);
  assert.equal(streamly.priceChanged, false);
});

test('a yearly one can’t come back two months later at a similar price', () => {
  const domain = api.subscriptions().list.find((s) => s.id === 'dom');
  assert.deepEqual(domain.charges.map((c) => c.date), ['2026-09-29']);
  assert.equal(domain.nextDate, '2027-09-29');
});

test('linked by name to a mixed payer, it says so and offers the right day', () => {
  const cloudStorage = api.subscriptions().list.find((s) => s.id === 'cloud');
  assert.ok(cloudStorage.count > 7, 'it grabbed other PayPal payments too');
  assert.ok(cloudStorage.mixed);
  assert.equal(cloudStorage.mixed.day, 8);
  assert.equal(cloudStorage.mixed.high, 98765);
});

test('monthly and yearly totals, whatever the interval', () => {
  const s = api.subscriptions();
  assert.equal(s.yearlyCents, 1000 * 12 + 200 * 12 + 1200);
  assert.equal(s.monthlyCents, 1000 + 200 + Math.round(1200 / 12));
});

test('the payment matcher: amount within 5%, day within 4 (wrapping around the month end)', () => {
  const sub = { amountCents: 1000, every: 'month', byAmount: true, day: 30 };
  const t = (date, cents) => ({ booking_date: date, amount_cents: -cents });
  assert.ok(api.fitsSub(sub, t('2026-10-30', 1000)));
  assert.ok(api.fitsSub(sub, t('2026-10-02', 1040)), '2nd is 3 days after the 30th; €10,40 is 4% more');
  assert.ok(!api.fitsSub(sub, t('2026-10-05', 1000)), '5 days off');
  assert.ok(!api.fitsSub(sub, t('2026-10-30', 1060)), '6% more');
  assert.ok(api.fitsSub({ ...sub, every: 'year' }, t('2026-03-12', 1000)), 'a yearly one ignores the day');
});

test('found automatically: PayPal split by amount, a friend never', () => {
  setConfig({ subscriptions: [] });
  const found = api.insights({ skipSubscriptions: true }).items.filter((i) => i.kind === 'subscription');
  const byId = Object.fromEntries(found.map((i) => [i.id, i]));
  const key = 'PAYPAL EUROPE S.A.R.L. ET CIE S.C.A';
  assert.equal(byId[`subscription:${key}:1000`]?.day, 22);
  assert.equal(byId[`subscription:${key}:200`]?.day, 8);
  assert.ok(!found.some((i) => i.key.startsWith('DOE')), 'paying a friend the same amount is not a subscription');
  const suggested = api.subscriptions().suggestions.filter((x) => x.match === 'paypal').map((x) => x.amountCents).sort((a, b) => a - b);
  assert.deepEqual(suggested, [200, 1000]);
});
