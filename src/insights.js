// "Where could I cut?": local, deterministic detection over your own transactions. Nothing here calls
// out; the optional AI step (in api.js) only ranks and phrases what this finds.
//
// Kinds:
//   subscription  the same amount charged every month or year
//   price         a subscription that got more expensive
//   creep         a pot that went up over the last 3 months compared with the 3 before
//   frequent      small payments to the same merchant, many times a month
//   duplicate     the same amount to the same merchant twice within a day (lately)
//   want          your biggest wants, when wants are over their share of income
// Each finding has a yearly figure: what it costs, or what a realistic change would save.
import { db } from './db.js';
import { merchantKey } from './categories.js';

const DAY = 86_400_000;
const dayNum = (iso) => Date.parse(iso + 'T00:00:00Z') / DAY;
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : 0;
};

// Payers that pay shops on your behalf, so one name covers many different things.
export const PLATFORM = /paypal|klarna|apple\.com|apple services|itunes|google|stripe|mollie|amazon|bancontact|payconiq/i;

export function findInsights({ today, periods, transferCategory, isIncome, groupOf, income, wantShare }) {
  const since = new Date(Date.parse(today) - 400 * DAY).toISOString().slice(0, 10);
  const txs = db
    .prepare(`SELECT id, booking_date, amount_cents, counterparty, description, category FROM transactions
              WHERE amount_cents < 0 AND booking_date BETWEEN ? AND ? AND category IS NOT NULL AND category IS NOT ?
              ORDER BY booking_date`)
    .all(since, today, transferCategory ?? null)
    .filter((t) => !isIncome(t.category));
  // Money paid back into a pot lowers it, as everywhere else in the app (for creep and wants).
  const back = db
    .prepare(`SELECT booking_date, amount_cents, counterparty, description, category FROM transactions
              WHERE amount_cents > 0 AND booking_date BETWEEN ? AND ? AND category IS NOT NULL AND category IS NOT ?`)
    .all(since, today, transferCategory ?? null)
    .filter((t) => !isIncome(t.category));
  const byMerchant = new Map();
  for (const t of txs) {
    const k = merchantKey(t);
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k).push(t);
  }
  const now = dayNum(today);
  const out = [];
  const add = (f) => out.push({ ...f, group: groupOf(f.category) });

  // Subscriptions and price rises: regular gaps, and nearly the same amount each time.
  // A payer that carries many different things (PayPal: every payment just says "PayPal") is split by
  // amount instead, and each amount that comes back around the same day of the month is checked on its own.
  const subscription = (key, list, extra = {}) => {
    if (list.length < 2) return false;
    const gaps = list.slice(1).map((t, i) => dayNum(t.booking_date) - dayNum(list[i].booking_date));
    const gap = median(gaps);
    const monthly = gap >= 25 && gap <= 36 && list.length >= 3;
    const yearly = gap >= 330 && gap <= 400;
    if (!monthly && !yearly) return false;
    const amounts = list.map((t) => -t.amount_cents);
    const last = amounts.at(-1);
    const before = median(amounts.slice(0, -1));
    const steady = amounts.slice(0, -1).filter((a) => Math.abs(a - before) <= Math.max(50, before * 0.03)).length / (amounts.length - 1);
    if (steady < 0.75) return false; // fuel, groceries and the like vary too much to be a subscription
    if (amounts.at(-1) < (extra.byAmount ? 200 : 300) || /eating|groceries|transport|food|restaurant/i.test(list.at(-1).category)) return true; // a regular coffee isn't a subscription
    const lastDate = list.at(-1).booking_date;
    if (now - dayNum(lastDate) > gap * 1.6) return true; // stopped already
    const perYear = monthly ? 12 : 1;
    const id = extra.byAmount ? `${key}:${amounts.at(0)}` : key;
    const base = { key, category: list.at(-1).category, interval: monthly ? 'month' : 'year', amountCents: last, count: list.length, firstDate: list[0].booking_date, lastDate, ...extra };
    if (extra.byAmount && monthly) base.day = extra.day;
    add({ id: `subscription:${id}`, kind: 'subscription', ...base, yearlyCents: last * perYear });
    if (last > before * 1.05 && last - before >= 50) {
      const from = list.findLast((t) => -t.amount_cents <= before * 1.02);
      add({ id: `price:${id}:${last}`, kind: 'price', ...base, fromCents: Math.round(before), since: list.find((t, i) => i > list.indexOf(from) && -t.amount_cents === last)?.booking_date ?? lastDate, yearlyCents: Math.round((last - before) * perYear) });
    }
    return true;
  };
  for (const [key, list] of byMerchant) {
    if (subscription(key, list)) continue;
    const byCents = new Map();
    for (const t of list) byCents.set(-t.amount_cents, [...(byCents.get(-t.amount_cents) ?? []), t]);
    if (byCents.size <= 3 || !PLATFORM.test(key)) continue;
    for (const same of byCents.values()) {
      if (same.length < 2) continue;
      const days = same.map((t) => Number(t.booking_date.slice(8, 10))).sort((x, y) => x - y);
      const day = days[Math.floor(days.length / 2)];
      const near = same.filter((t) => { const d = Math.abs(Number(t.booking_date.slice(8, 10)) - day); return Math.min(d, 31 - d) <= 4; });
      // Monthly ones land around the same day; yearly ones only need the same amount.
      subscription(key, near.length >= 3 ? near : same, { byAmount: true, day });
    }
  }

  // Creep: the last 3 finished months against the 3 before, per pot, with the merchants behind it.
  const finished = periods.filter((p) => p.end).slice(0, 6).reverse();
  if (finished.length === 6) {
    const recent = finished.slice(3);
    const earlier = finished.slice(0, 3);
    const inRange = (t, ps) => ps.some((p) => t.booking_date >= p.start && t.booking_date <= p.end);
    const byCat = new Map();
    for (const t of [...txs, ...back]) {
      const which = inRange(t, recent) ? 'recent' : inRange(t, earlier) ? 'earlier' : null;
      if (!which) continue;
      const c = byCat.get(t.category) ?? { recent: 0, earlier: 0, months: [0, 0, 0], merchants: new Map() };
      c[which] -= t.amount_cents;
      if (which === 'recent') c.months[recent.findIndex((p) => t.booking_date >= p.start && t.booking_date <= p.end)] -= t.amount_cents;
      const m = c.merchants.get(merchantKey(t)) ?? { recent: 0, earlier: 0, count: 0 };
      m[which] -= t.amount_cents;
      if (which === 'recent' && t.amount_cents < 0) m.count += 1;
      c.merchants.set(merchantKey(t), m);
      byCat.set(t.category, c);
    }
    for (const [category, c] of byCat) {
      const r = c.recent / 3;
      const e = c.earlier / 3;
      if (r - e < 3000 || r < e * 1.25) continue;
      // A real rise shows in most recent months, not in one big one (a festival, a trip).
      if (median(c.months) < e * 1.15) continue;
      const drivers = [...c.merchants].map(([who, m]) => ({ who, deltaCents: Math.round((m.recent - m.earlier) / 3), count: m.count }))
        .filter((m) => m.deltaCents > 0).sort((a, b) => b.deltaCents - a.deltaCents).slice(0, 3);
      // The typical recent month (not the average) against before, so one big month doesn't inflate it.
      const typical = median(c.months);
      add({ id: `creep:${category}:${recent.at(-1).month}`, kind: 'creep', key: category, category, recentCents: Math.round(typical), earlierCents: Math.round(e), drivers, months: recent.map((p) => p.month), yearlyCents: Math.round((typical - e) * 12) });
    }
  }

  // Small and often: 8+ payments to one merchant in 90 days, under € 20 each. Halving it is the estimate.
  for (const [key, list] of byMerchant) {
    const recent = list.filter((t) => now - dayNum(t.booking_date) <= 90);
    if (recent.length < 8) continue;
    const total = recent.reduce((s, t) => s - t.amount_cents, 0);
    const avg = total / recent.length;
    if (avg >= 2000) continue;
    const perMonth = Math.round(total / 3);
    add({ id: `frequent:${key}`, kind: 'frequent', key, category: recent.at(-1).category, count: recent.length, averageCents: Math.round(avg), monthlyCents: perMonth, yearlyCents: Math.round(perMonth * 12 / 2) });
  }

  // Possible double charges in the last 60 days.
  for (const [key, list] of byMerchant) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (a.amount_cents !== b.amount_cents || -b.amount_cents < 500) continue;
      if (dayNum(b.booking_date) - dayNum(a.booking_date) > 1 || now - dayNum(b.booking_date) > 60) continue;
      add({ id: `duplicate:${b.id}`, kind: 'duplicate', key, category: b.category, amountCents: -b.amount_cents, dates: [a.booking_date, b.booking_date], yearlyCents: -b.amount_cents });
    }
  }

  // Biggest wants, when wants as a whole are over their share: what bringing each in line would save.
  if (finished.length && income > 0) {
    const wants = new Map();
    for (const t of [...txs, ...back]) {
      if (groupOf(t.category) !== 'wants') continue;
      if (!finished.some((p) => t.booking_date >= p.start && t.booking_date <= p.end)) continue;
      wants.set(t.category, (wants.get(t.category) ?? 0) - t.amount_cents);
    }
    const avg = [...wants].map(([category, c]) => ({ category, cents: Math.max(0, Math.round(c / finished.length)) })).sort((a, b) => b.cents - a.cents);
    const total = avg.reduce((s, w) => s + w.cents, 0);
    const over = total - income * wantShare;
    if (over > 0) {
      for (const w of avg.slice(0, 3)) {
        const save = Math.round((w.cents / total) * over); // its fair share of the overspend
        add({ id: `want:${w.category}`, kind: 'want', key: w.category, category: w.category, monthlyCents: w.cents, shareOfIncome: w.cents / income, cutCents: save, yearlyCents: save * 12 });
      }
    }
  }

  return out.sort((a, b) => b.yearlyCents - a.yearlyCents);
}
