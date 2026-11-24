// The app's data layer: queries over the SQLite database the CLI uses, and the JSON API the UI calls.
// Next.js server components call the query functions directly; app/api/[...path]/route.js serves api().
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { db } from './db.js';
import * as savingsMaths from '../lib/savings.js';
import { findInsights } from './insights.js';
import { budgetIn, readiness, runFund } from './funds.js';
import {
  addCategory, addOwnIbans, addRule, applyRules, deleteRule, escapeRegex, groupUncategorised, incomeSettings, loadConfig,
  featureSettings, fitsSub, matchesAll, merchantKey, normIban, removeOwnIbans, saveConfig, saveFeatures, saveIncomeSettings, setIncomingCategory, setManualCategory,
} from './categories.js';
import { restoreRule } from './categories.js';
import { endingSoon } from './reminders.js';
import { SAMPLE_SESSION } from './sample.js';

// Survives Next.js dev reloads, so asking Claude again isn't needed after every code change.
const suggestionCache = (globalThis.__budgetSuggestions ??= new Map()); // merchant key -> { category, reason }
// BUDGET_TODAY pins the date (tests, demos); otherwise it's today.
const today = () => process.env.BUDGET_TODAY || new Date().toISOString().slice(0, 10);

// An error worded for the person using Munto: its message is shown as it is (a crash's isn't).
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

// ---------- queries ----------

const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

// Budget months run from payday to payday. "October" starts on the day the salary for October lands
// (the biggest payment from a salary payer booked on or after day `paydayFromDay` of September, e.g. on
// the ~25th; with no salary payer chosen, the biggest income payment) and ends the day before the next
// payday. One-off income never starts a month. A month without a payday found starts on its 1st.
// The latest period stays open until the next salary arrives.
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

export function budgetPeriods() {
  const config = loadConfig();
  const { incomeCategories = ['Income'] } = config;
  const { paydayFromDay, salary } = incomeSettings(config);
  const salaryFrom = new Set(salary);
  const first = db.prepare('SELECT min(booking_date) AS d FROM transactions').get().d;
  if (!first) return [];
  const paydays = new Map(); // month it pays for -> booking date
  if (paydayFromDay > 0 && incomeCategories.length) {
    const rows = db
      .prepare(`
        SELECT booking_date, counterparty, description FROM transactions
        WHERE amount_cents > 0 AND booking_date <= ? AND category IN (${incomeCategories.map(() => '?').join(', ')})
          AND CAST(substr(booking_date, 9, 2) AS INTEGER) >= ? AND NOT one_off
        ORDER BY amount_cents DESC
      `)
      .all(today(), ...incomeCategories, paydayFromDay);
    for (const r of rows) {
      if (salaryFrom.size && !salaryFrom.has(merchantKey(r))) continue;
      const m = shiftMonth(r.booking_date.slice(0, 7), 1);
      if (!paydays.has(m)) paydays.set(m, r.booking_date);
    }
  }
  const startOf = (m) => paydays.get(m) ?? `${m}-01`;
  const periods = [];
  for (let m = first.slice(0, 7); startOf(m) <= today(); m = shiftMonth(m, 1)) {
    const next = startOf(shiftMonth(m, 1));
    periods.push({ month: m, start: startOf(m), end: next <= today() ? addDays(next, -1) : null, payday: paydays.has(m) });
  }
  return periods.filter((p) => (p.end ?? today()) >= first).reverse(); // newest first
}

const periodOf = (periods, date) => periods.find((p) => p.start <= date && (p.end == null || date <= p.end))?.month ?? null;

// The month at a glance. Every non-income category is a "pot": its net is what went out minus
// what came back (people paying you back, refunds), so paid-back money lowers the category it belongs to.
// Transfers between your own accounts and future scheduled payments are left out.
export function overview(requestedMonth) {
  const config = loadConfig();
  const { incomeCategories = ['Income'], transferCategory, ownAccountNames = {}, savingsPlan = {} } = config;
  const { expectedMonthlyCents } = incomeSettings(config);
  const isIncome = (category) => incomeCategories.includes(category);
  const periods = budgetPeriods();
  const months = periods.map((p) => p.month);
  const month = months.includes(requestedMonth) ? requestedMonth : months[0];
  const uncategorised = db.prepare('SELECT count(*) AS n FROM transactions WHERE category IS NULL').get().n;
  if (!month) return { months, month: null, uncategorised };
  const period = periods.find((p) => p.month === month);
  const previousPeriod = periods.find((p) => p.month === shiftMonth(month, -1)) ?? null;

  const dayRows = db
    .prepare(`
      SELECT booking_date, category,
             sum(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) AS out_cents,
             sum(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS in_cents,
             sum(CASE WHEN amount_cents > 0 AND one_off THEN amount_cents ELSE 0 END) AS one_off_cents,
             count(*) AS n
      FROM transactions
      WHERE booking_date <= ? AND category IS NOT ?
      GROUP BY 1, 2
    `)
    .all(today(), transferCategory ?? null);
  // Roll the per-day sums up into budget months.
  const byMonth = new Map();
  for (const r of dayRows) {
    const m = periodOf(periods, r.booking_date);
    if (!m) continue;
    const key = `${m}\u0000${r.category}`;
    const g = byMonth.get(key) ?? { month: m, category: r.category, out_cents: 0, in_cents: 0, one_off_cents: 0, n: 0 };
    g.out_cents += r.out_cents;
    g.in_cents += r.in_cents;
    g.one_off_cents += r.one_off_cents;
    g.n += r.n;
    byMonth.set(key, g);
  }
  const rows = [...byMonth.values()];

  // Money moved to your own savings or investment accounts. It isn't spending, but it does leave
  // the account, so the ledger shows it as its own line: Income − Spent − Saved = Left.
  // Each destination account is a savings pot, named in `ownAccountNames` (by IBAN or merchant).
  const savedByMonth = new Map();
  const savingsPots = new Map(); // `${month}\0${key}` -> { month, key, name, iban, put, took, count }
  if (transferCategory) {
    const transfers = db
      .prepare("SELECT booking_date, amount_cents, counterparty, counterparty_iban, description FROM transactions WHERE booking_date <= ? AND category = ? AND category_source IS NOT 'mirror'")
      .all(today(), transferCategory);
    for (const t of transfers) {
      const m = periodOf(periods, t.booking_date);
      if (!m) continue;
      savedByMonth.set(m, (savedByMonth.get(m) ?? 0) - t.amount_cents);
      const iban = t.counterparty_iban ? normIban(t.counterparty_iban) : null;
      const key = iban ?? merchantKey(t);
      const id = `${m}\u0000${key}`;
      const pot = savingsPots.get(id) ?? { month: m, key, iban, name: ownAccountNames[key] ?? null, who: merchantKey(t), put: 0, took: 0, count: 0 };
      if (t.amount_cents < 0) pot.put -= t.amount_cents; else pot.took += t.amount_cents;
      pot.count += 1;
      savingsPots.set(id, pot);
    }
  }

  const monthTotals = (m) => {
    const inMonth = rows.filter((r) => r.month === m);
    const income = inMonth.filter((r) => isIncome(r.category)).reduce((s, r) => s + r.in_cents - r.out_cents, 0);
    const spent = inMonth.filter((r) => !isIncome(r.category)).reduce((s, r) => s + r.out_cents - r.in_cents, 0);
    const paidBack = inMonth.filter((r) => !isIncome(r.category) && r.category).reduce((s, r) => s + r.in_cents, 0);
    const oneOff = inMonth.filter((r) => isIncome(r.category)).reduce((s, r) => s + r.one_off_cents, 0);
    const saved = savedByMonth.get(m) ?? 0;
    return { month: m, income, oneOff, spent, paidBack, saved, left: income - spent - saved };
  };

  // "Usual" for a pot = its average net over the three months before this one (months with data).
  const previous = [1, 2, 3].map((d) => shiftMonth(month, -d)).filter((m) => months.includes(m));
  const usualFor = (category) => {
    if (previous.length === 0) return null;
    const total = rows
      .filter((r) => previous.includes(r.month) && r.category === category)
      .reduce((s, r) => s + r.out_cents - r.in_cents, 0);
    return Math.round(total / previous.length);
  };

  const savings = [...savingsPots.values()]
    .filter((p) => p.month === month)
    .map((p) => {
      const before = previous.map((m) => savingsPots.get(`${m}\u0000${p.key}`)).filter(Boolean);
      const usual = previous.length ? Math.round(before.reduce((s, b) => s + b.put - b.took, 0) / previous.length) : null;
      const plan = savingsPlan[p.key];
      return {
        key: p.key, iban: p.iban, name: p.name, who: p.who, put: p.put, took: p.took, net: p.put - p.took, count: p.count, usual,
        planned: plan?.mode === 'fixed' ? plan.monthlyCents : null,
      };
    })
    .sort((a, b) => b.net - a.net);
  // Accounts with a fixed plan show up even before anything went in this month ("€ 300 to go").
  for (const [key, plan] of Object.entries(savingsPlan)) {
    if (plan.mode !== 'fixed' || savings.some((p) => p.key === key)) continue;
    const before = previous.map((m) => savingsPots.get(`${m}\u0000${key}`)).filter(Boolean);
    const iban = /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(key) ? key : null;
    const who = before[0]?.who ?? key;
    savings.push({
      key, iban, name: ownAccountNames[key] ?? null, who, put: 0, took: 0, net: 0, count: 0,
      usual: previous.length ? Math.round(before.reduce((s, b) => s + b.put - b.took, 0) / previous.length) : null,
      planned: plan.monthlyCents,
    });
  }

  const pots = rows
    .filter((r) => r.month === month && !isIncome(r.category))
    .map((r) => ({
      category: r.category,
      out: r.out_cents,
      back: r.in_cents,
      net: r.out_cents - r.in_cents,
      count: r.n,
      usual: usualFor(r.category),
      budget: config.budgets?.[r.category] ?? null,
    }))
    .sort((a, b) => b.net - a.net);
  // Pots with a budget show up even before anything was spent in them this month.
  for (const [category, cents] of Object.entries(config.budgets ?? {})) {
    if (cents > 0 && !pots.some((e) => e.category === category)) {
      pots.push({ category, out: 0, back: 0, net: 0, count: 0, usual: usualFor(category), budget: cents });
    }
  }

  // Funds: what the pot carried in from earlier months, and what the month keeps in (or takes out of) it.
  // Left minus what the funds keep is what's really free.
  let kept = null;
  for (const f of funds()) {
    const row = f.months.find((x) => x.month === month);
    if (!row) continue;
    let e = pots.find((x) => x.category === f.category);
    if (!e) pots.push((e = { category: f.category, out: 0, back: 0, net: 0, count: 0, usual: usualFor(f.category) }));
    e.budget = row.putIn;
    e.fund = { carried: row.carried, spent: row.spent, fromFund: row.fromFund, balance: row.balance }; // spent: from the day the fund started
    kept = (kept ?? 0) + row.putIn - row.spent;
  }

  // Individual transactions of this and last month, for the money-in lists, top merchants and the pace line.
  const txs = db
    .prepare(`
      SELECT booking_date, amount_cents, counterparty, description, category, one_off FROM transactions
      WHERE booking_date BETWEEN ? AND ? AND category IS NOT ?
    `)
    .all((previousPeriod ?? period).start, period.end ?? today(), transferCategory ?? null);
  const thisMonth = txs.filter((t) => periodOf(periods, t.booking_date) === month);

  const groupBy = (list, keyOf) => {
    const map = new Map();
    for (const t of list) {
      const key = keyOf(t);
      const g = map.get(key) ?? { cents: 0, count: 0 };
      g.cents += Math.abs(t.amount_cents);
      g.count += 1;
      map.set(key, g);
    }
    return map;
  };
  const incoming = thisMonth.filter((t) => t.amount_cents > 0);
  const incomeTxs = incoming.filter((t) => isIncome(t.category));
  const incomeFrom = [...groupBy(incomeTxs, merchantKey)]
    .map(([who, g]) => {
      const dates = incomeTxs.filter((t) => merchantKey(t) === who).map((t) => t.booking_date).sort();
      const oneOff = incomeTxs.filter((t) => t.one_off && merchantKey(t) === who).reduce((s, t) => s + t.amount_cents, 0);
      return { who, ...g, oneOff, firstDate: dates[0], lastDate: dates.at(-1) };
    })
    .sort((a, b) => b.cents - a.cents);
  const paidBackFrom = [...groupBy(incoming.filter((t) => t.category && !isIncome(t.category)), (t) => `${merchantKey(t)}\u0000${t.category}`)]
    .map(([key, g]) => { const [who, category] = key.split('\u0000'); return { who, category, ...g }; })
    .sort((a, b) => b.cents - a.cents);

  const merchantCategory = new Map();
  for (const t of thisMonth) if (t.amount_cents < 0) merchantCategory.set(merchantKey(t), t.category);
  const topMerchants = [...groupBy(thisMonth.filter((t) => t.amount_cents < 0 && !isIncome(t.category)), merchantKey)]
    .map(([who, g]) => ({ who, category: merchantCategory.get(who) ?? null, ...g }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 8);

  // Cumulative net spending per day since payday, this month and last month, for the pace chart.
  // An open period is drawn as long as a month from its start.
  const cumulative = (p) => {
    if (!p) return { start: null, days: 0, values: [] };
    const [y, mo, d] = p.start.split('-').map(Number);
    const last = p.end ?? addDays(new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10), -1);
    const days = daysBetween(p.start, last) + 1;
    const perDay = new Array(days).fill(0);
    for (const t of txs) {
      if (t.booking_date < p.start || t.booking_date > last || isIncome(t.category)) continue;
      perDay[daysBetween(p.start, t.booking_date)] -= t.amount_cents;
    }
    const upTo = p.end ? days : Math.min(days, daysBetween(p.start, today()) + 1);
    let run = 0;
    return { start: p.start, days, values: perDay.slice(0, upTo).map((v) => (run += v)) };
  };

  // Up to twelve months ending at this one, for the trend charts, with each pot's net.
  const trendMonths = months.slice(months.indexOf(month), months.indexOf(month) + 12).reverse();
  const withPots = (m) => {
    const byCategory = {};
    for (const r of rows) if (r.month === m && !isIncome(r.category)) byCategory[r.category ?? ''] = r.out_cents - r.in_cents;
    return { ...monthTotals(m), byCategory };
  };
  return {
    months,
    month,
    period,
    isCurrent: period.end == null,
    expectedIncome: expectedMonthlyCents,
    totals: { ...monthTotals(month), kept },
    previousTotals: previousPeriod ? monthTotals(previousPeriod.month) : null,
    pots,
    savings,
    incomeFrom,
    paidBackFrom,
    topMerchants,
    pace: { current: cumulative(period), previous: cumulative(previousPeriod) },
    trend: trendMonths.map(withPots),
    uncategorised,
    lastSynced: lastSynced(),
    accessEnding: endingSoon(bankAccess()),
  };
}

export function transactions({ month, day, category, q, account, direction, iban }) {
  const where = [];
  const params = [];
  if (direction === 'in') where.push('t.amount_cents > 0');
  if (direction === 'out') where.push('t.amount_cents < 0');
  if (month) {
    const period = budgetPeriods().find((p) => p.month === month);
    if (period) { where.push('t.booking_date BETWEEN ? AND ?'); params.push(period.start, period.end ?? today()); }
    else { where.push('substr(t.booking_date, 1, 7) = ?'); params.push(month); }
  }
  if (day) { where.push('t.booking_date = ?'); params.push(day); }
  if (category === '__none') where.push('t.category IS NULL');
  else if (category) { where.push('t.category = ?'); params.push(category); }
  if (account) { where.push('t.account_uid = ?'); params.push(account); }
  if (iban) { where.push("upper(replace(t.counterparty_iban, ' ', '')) = ?"); params.push(normIban(iban)); }
  if (q) {
    where.push("(lower(coalesce(t.counterparty, '') || ' ' || coalesce(t.description, '')) LIKE ?)");
    params.push(`%${q.toLowerCase()}%`);
  }
  return db
    .prepare(`
      SELECT t.id, t.booking_date, t.amount_cents, t.currency, t.counterparty, t.description, t.status,
             t.category, t.category_source, t.one_off, a.name AS account_name, a.iban AS account_iban
      FROM transactions t JOIN accounts a ON a.uid = t.account_uid
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.booking_date DESC, t.id
      LIMIT 1000
    `)
    .all(...params)
    .map((t) => ({ ...t, merchant: merchantKey(t) }));
}

// Who pays you: every payer in an income pot over the last 6 months, plus anyone else who paid you
// in at least 3 of those months (family chipping in for rent, say), so they can be counted as income.
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2)) : null;
};
const incomingFrom = (key, transferCategory) => db
  .prepare('SELECT * FROM transactions WHERE amount_cents > 0 AND category IS NOT ?')
  .all(transferCategory ?? null)
  .filter((t) => merchantKey(t) === key);

export function income() {
  const config = loadConfig();
  const { incomeCategories = ['Income'], transferCategory } = config;
  const settings = incomeSettings(config);
  const isIncome = (category) => incomeCategories.includes(category);
  const periods = budgetPeriods();
  const recent = periods.slice(0, 7); // this month and the six before it
  const since = recent.at(-1)?.start ?? today();
  const txs = db
    .prepare(`
      SELECT id, booking_date, amount_cents, counterparty, description, category, category_source, one_off
      FROM transactions WHERE amount_cents > 0 AND booking_date BETWEEN ? AND ? AND category IS NOT ?
      ORDER BY booking_date DESC
    `)
    .all(since, today(), transferCategory ?? null);

  const groups = new Map();
  for (const t of txs) {
    const key = merchantKey(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  let sources = [...groups].map(([key, list]) => {
    const months = new Set(list.map((t) => periodOf(periods, t.booking_date)));
    const inIncome = list.filter((t) => isIncome(t.category));
    const counts = new Map();
    for (const t of list) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return {
      key,
      kind: settings.salary.includes(key) ? 'salary' : inIncome.length * 2 >= list.length ? 'other' : 'none',
      category: [...counts].sort((a, b) => b[1] - a[1])[0][0],
      count: list.length,
      months: months.size,
      totalCents: list.reduce((s, t) => s + t.amount_cents, 0),
      usualCents: median(list.filter((t) => !t.one_off).map((t) => t.amount_cents)),
      lastDate: list[0].booking_date,
      payments: list.slice(0, 12).map((t) => ({ id: t.id, date: t.booking_date, cents: t.amount_cents, oneOff: !!t.one_off })),
    };
  }).filter((s) => s.kind !== 'none' || s.months >= 3);

  // No salary payer chosen yet: the biggest income payer is the one that starts the month.
  const detected = settings.salary.length === 0
    ? sources.filter((s) => s.kind === 'other').sort((a, b) => b.totalCents - a.totalCents)[0]?.key ?? null
    : null;
  sources = sources
    .map((s) => (s.key === detected ? { ...s, kind: 'salary', detected: true } : s))
    .sort((a, b) => ['salary', 'other', 'none'].indexOf(a.kind) - ['salary', 'other', 'none'].indexOf(b.kind) || b.totalCents - a.totalCents);

  // A suggestion for expected income: the median regular income of the finished months.
  const regular = recent.filter((p) => p.end).map((p) => txs
    .filter((t) => isIncome(t.category) && !t.one_off && t.booking_date >= p.start && t.booking_date <= p.end)
    .reduce((s, t) => s + t.amount_cents, 0)).filter((c) => c > 0);

  // Every month so far, oldest first: salary, other income and one-offs, for the income chart.
  const salaryFrom = new Set(settings.salary.length ? settings.salary : [detected].filter(Boolean));
  const months = new Map([...periods].reverse().map((p) => [p.month, { month: p.month, salary: 0, other: 0, oneOff: 0, current: p.end == null }]));
  const allIncome = db
    .prepare(`SELECT booking_date, amount_cents, counterparty, description, one_off FROM transactions
              WHERE booking_date <= ? AND category IN (${incomeCategories.map(() => '?').join(', ')})`)
    .all(today(), ...incomeCategories);
  for (const t of allIncome) {
    const m = months.get(periodOf(periods, t.booking_date));
    if (!m) continue;
    if (t.one_off && t.amount_cents > 0) m.oneOff += t.amount_cents;
    else if (salaryFrom.has(merchantKey(t))) m.salary += t.amount_cents;
    else m.other += t.amount_cents;
  }
  return {
    ...settings,
    incomeCategory: incomeCategories[0],
    // From the first month with income (the months before it are just history before your first salary).
    history: [...months.values()].map((m) => ({ ...m, total: m.salary + m.other + m.oneOff }))
      .filter((m, i, all) => all.slice(0, i + 1).some((x) => x.salary + x.other + x.oneOff > 0)),
    period: periods[0] ?? null,
    sources,
    suggestedExpectedCents: median(regular),
  };
}

// Every savings account (each own account money moved to), month by month, with its plan from
// `savingsPlan` in the config: { mode: fixed | average | off, monthlyCents, annualReturn, balanceCents, balanceDate }.
const INVESTING = /saxo|bux|invest|beleg|degiro|bolero|etf|keytrade|trade republic|pension|pensioen/i;
export function savings() {
  const config = loadConfig();
  const { transferCategory, ownAccountNames = {}, savingsPlan = {} } = config;
  const periods = budgetPeriods();
  const months = [...periods].reverse().map((p) => p.month);
  const finished = periods.filter((p) => p.end).slice(0, 6).map((p) => p.month);
  const pots = new Map();
  if (transferCategory) {
    const transfers = db
      .prepare("SELECT booking_date, amount_cents, counterparty, counterparty_iban, description FROM transactions WHERE booking_date <= ? AND category = ? AND category_source IS NOT 'mirror' ORDER BY booking_date")
      .all(today(), transferCategory);
    for (const t of transfers) {
      const m = periodOf(periods, t.booking_date);
      if (!m) continue;
      const iban = t.counterparty_iban ? normIban(t.counterparty_iban) : null;
      const key = iban ?? merchantKey(t);
      const pot = pots.get(key) ?? { key, iban, name: ownAccountNames[key] ?? null, who: merchantKey(t), byMonth: {}, count: 0, firstDate: t.booking_date, lastDate: null };
      pot.byMonth[m] = (pot.byMonth[m] ?? 0) - t.amount_cents; // money out of the main account = into savings
      pot.count += 1;
      pot.lastDate = t.booking_date;
      pots.set(key, pot);
    }
  }
  const list = [...pots.values()].map((p) => {
    const net = Object.values(p.byMonth).reduce((a, b) => a + b, 0);
    const average = finished.length ? Math.round(finished.reduce((s, m) => s + (p.byMonth[m] ?? 0), 0) / finished.length) : 0;
    const label = p.name ?? p.who;
    const plan = savingsPlan[p.key] ?? null;
    return {
      ...p,
      net,
      average,
      thisMonth: p.byMonth[months.at(-1)] ?? 0,
      investing: INVESTING.test(label),
      plan,
      suggestedReturn: INVESTING.test(label) ? 0.06 : 0.02,
    };
  }).sort((a, b) => (a.plan?.mode === 'off') - (b.plan?.mode === 'off') || b.net - a.net);
  return { months, finished: finished.length, current: periods[0] ?? null, pots: list, goals: config.savingsGoals ?? [], today: today() };
}

// The budget page: per pot the net spend of the last 6 finished months, what kind of spending it
// is, a plain suggestion (no AI), and the budget you set (`budgets` in the config, in cents a month).
const roundUp = (cents, euros) => Math.ceil(cents / (euros * 100)) * euros * 100;
// The 50/30/20 rule: needs, wants and savings as a share of income. `budgetRule` in the config picks one.
export const BUDGET_RULES = { '50-30-20': [0.5, 0.3, 0.2], '60-20-20': [0.6, 0.2, 0.2], '70-20-10': [0.7, 0.2, 0.1] };
const NEEDS = /housing|rent|huur|utilit|energy|groceries|transport|health|insurance|pets|child|kids|school|loan|mortgage/i;
export const groupOf = (category, groups = {}) => groups[category] ?? (NEEDS.test(category) ? 'needs' : 'wants');
export function budget() {
  const config = loadConfig();
  const { incomeCategories = ['Income'], transferCategory, budgets = {}, budgetGroups = {} } = config;
  const rule = BUDGET_RULES[config.budgetRule] ? config.budgetRule : '50-30-20';
  const isIncome = (c) => incomeCategories.includes(c);
  const periods = budgetPeriods();
  const finished = periods.filter((p) => p.end).slice(0, 6).reverse(); // oldest first
  const current = periods.find((p) => p.end == null) ?? null;
  const ov = periods.length ? overview(periods[0].month) : null;
  const rows = finished.length ? db
    .prepare(`SELECT booking_date, category, amount_cents FROM transactions
              WHERE booking_date BETWEEN ? AND ? AND category IS NOT NULL AND category IS NOT ?`)
    .all(finished[0].start, finished.at(-1).end, transferCategory ?? null) : [];
  const net = new Map(); // category -> [cents per finished month]
  for (const r of rows) {
    if (isIncome(r.category)) continue;
    const i = finished.findIndex((p) => r.booking_date >= p.start && r.booking_date <= p.end);
    if (i < 0) continue;
    if (!net.has(r.category)) net.set(r.category, new Array(finished.length).fill(0));
    net.get(r.category)[i] -= r.amount_cents;
  }
  const categories = config.categories.filter((c) => !isIncome(c) && c !== transferCategory);
  const pots = categories.map((category) => {
    const months = (net.get(category) ?? new Array(finished.length).fill(0)).map((c) => Math.max(0, c));
    const sorted = [...months].sort((a, b) => a - b);
    const med = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
    const mean = months.length ? months.reduce((a, b) => a + b, 0) / months.length : 0;
    const active = months.filter((c) => c > 0).length;
    const sd = months.length ? Math.sqrt(months.reduce((s, c) => s + (c - mean) ** 2, 0) / months.length) : 0;
    const kind = mean < 1000 ? 'flexible'
      : active >= months.length - 1 && sd / mean < 0.2 ? 'fixed'
      : active <= Math.ceil(months.length / 2) || Math.max(...months) > 2.5 * Math.max(med, 1) ? 'irregular'
      : 'flexible';
    // Without AI: fixed = the latest typical amount, flexible = the median, irregular = the average.
    const plain = mean < 500 ? 0
      : kind === 'fixed' ? roundUp(months.filter((c) => c > 0).at(-1) ?? med, 5)
      : kind === 'irregular' ? roundUp(mean, 10)
      : roundUp(med, 10);
    const spentNow = Math.max(0, ov?.pots.find((e) => e.category === category)?.net ?? 0);
    return {
      category, kind, group: groupOf(category, budgetGroups), months, median: Math.round(med), average: Math.round(mean),
      low: sorted[0] ?? 0, high: sorted.at(-1) ?? 0, plain, budget: budgets[category] ?? null, spentNow,
    };
  }).sort((a, b) => b.average - a.average);

  const sv = savings();
  const { monthlyDeposit } = savingsMaths;
  const plannedSavings = sv.pots.filter((p) => p.plan?.mode !== 'off').reduce((s, p) => s + monthlyDeposit(p), 0);
  const { expectedMonthlyCents } = incomeSettings(config);
  const typicalIncome = income().suggestedExpectedCents;
  // What actually went to savings: the average of the finished months, accounts left out of the plan excluded.
  const savedAverage = sv.pots.filter((p) => p.plan?.mode !== 'off').reduce((s, p) => s + p.average, 0);
  const savedMonths = finished.map((f) => sv.pots.filter((p) => p.plan?.mode !== 'off').reduce((s, p) => s + (p.byMonth[f.month] ?? 0), 0));
  return {
    months: finished.map((p) => p.month),
    current,
    pots,
    rule,
    rules: BUDGET_RULES,
    savedAverage,
    savedMonths,
    income: expectedMonthlyCents ?? typicalIncome ?? 0,
    incomeIsExpected: expectedMonthlyCents != null,
    plannedSavings,
    funds: funds(),
    lookback: lookback(),
    yearlyCosts: yearlyCosts(config).filter((y) => y.category),
    // Days until the month likely ends: a month after it started (the next payday isn't known yet).
    daysLeft: current ? Math.max(0, daysBetween(today(), shiftMonth(current.start.slice(0, 7), 1) + current.start.slice(7))) : null,
  };
}

// Your yearly and quarterly subscriptions, with the pot they're in and when they're next due.
function yearlyCosts(config) {
  return (config.subscriptions ?? []).filter((s) => s.every === 'year' || s.every === 'quarter').map((sub) => {
    const last = chargesFor(sub, config.transferCategory)[0] ?? null;
    return { name: sub.name, every: sub.every, category: sub.category ?? last?.category ?? null, cents: sub.amountCents, date: last ? addDays(last.booking_date, Math.round(DAYS[sub.every])) : null };
  });
}

// Sinking funds (`funds` in the config, per pot: { since, startCents, history }): pots that keep
// what's left over. Per fund: every month since it started, the balance now, and the yearly or quarterly
// subscriptions in it that are coming up, with whether the fund will hold enough by then.
export function funds() {
  const config = loadConfig();
  const { budgets = {} } = config;
  const all = Object.entries(config.funds ?? {}).filter(([c]) => config.categories.includes(c));
  if (!all.length) return [];
  const periods = budgetPeriods();
  const current = periods.find((p) => p.end == null) ?? null;
  const labels = periods.map((p) => p.month).reverse(); // oldest first
  const since = all.reduce((m, [, f]) => (f.since < m ? f.since : m), all[0][1].since);
  // From the fund's start, or 6 months back for the everyday spending, whichever is earlier.
  const sixBack = periods[Math.min(6, periods.length - 1)]?.start;
  const startOf = periods.find((p) => p.month === since)?.start ?? `${since}-01`;
  const from = sixBack && sixBack < startOf ? sixBack : startOf;
  const spent = new Map(); // category -> { month: net }
  // A fund started mid-month only takes what's spent from that day on (`startDate`).
  const counts = (r, m) => { const f = config.funds[r.category]; return !(m === f.since && f.startDate && r.booking_date < f.startDate); };
  const everyday = new Map(); // category -> { month: net }, everything, for the median month
  for (const r of db.prepare(`SELECT booking_date, category, amount_cents FROM transactions
                              WHERE booking_date BETWEEN ? AND ? AND category IN (${all.map(() => '?').join(',')})`)
    .all(from, today(), ...all.map(([c]) => c))) {
    const m = periodOf(periods, r.booking_date);
    if (!m) continue;
    const e = everyday.get(r.category) ?? {};
    e[m] = (e[m] ?? 0) - r.amount_cents;
    everyday.set(r.category, e);
    if (!counts(r, m)) continue;
    const s = spent.get(r.category) ?? {};
    s[m] = (s[m] ?? 0) - r.amount_cents;
    spent.set(r.category, s);
  }
  const yearly = yearlyCosts(config);
  return all.map(([category, f]) => {
    const history = f.history?.length ? f.history : [{ from: f.since, cents: budgets[category] ?? 0 }];
    const months = runFund({ months: labels.filter((m) => m >= f.since), spent: spent.get(category) ?? {}, history, startCents: f.startCents ?? 0 });
    const now = months.at(-1) ?? { carried: f.startCents ?? 0, balance: f.startCents ?? 0 };
    // Everyday spending: the median of the last 6 finished months, so the big ones don't count.
    const before = labels.filter((m) => m < (current?.month ?? today().slice(0, 7))).slice(-6).map((m) => Math.max(0, everyday.get(category)?.[m] ?? 0));
    const upcoming = yearly.filter((s) => s.category === category && s.date && s.date >= today() && daysBetween(today(), s.date) <= 366)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      category, since: f.since, startDate: f.startDate ?? null, startCents: f.startCents ?? 0, budget: budgetIn(history, current?.month ?? f.since),
      months, balance: now.balance, carried: now.carried,
      upcoming: current ? readiness({ balance: now.balance, budget: budgets[category] ?? 0, everyday: median(before) ?? 0, upcoming, payday: current.start, today: today() }) : [],
    };
  });
}

// Budget history: `budgetHistory` in the config keeps, per pot, [{ from: 'YYYY-MM', cents }], so last month
// is judged by the budget it had then. A fund keeps its own (`funds[c].history`). Without any, the budget now applies.
function budgetAt(config, category, month) {
  const history = config.funds?.[category]?.history?.length ? config.funds[category].history : config.budgetHistory?.[category];
  return history?.length ? budgetIn(history, month) : (config.budgets?.[category] ?? null);
}
// Sets a budget from this month on (null removes it), remembering what it was before.
function setBudget(config, category, cents, month) {
  const before = config.budgets?.[category] ?? null;
  config.budgets = { ...(config.budgets ?? {}) };
  if (cents == null) delete config.budgets[category]; else config.budgets[category] = cents;
  if (!month || before === cents) return;
  const all = { ...(config.budgetHistory ?? {}) };
  const history = all[category]?.length ? all[category].filter((h) => h.from !== month) : [{ from: '0000-00', cents: before }];
  history.push({ from: month, cents });
  all[category] = history;
  config.budgetHistory = all;
  const f = config.funds?.[category];
  if (f) f.history = [...(f.history ?? []).filter((h) => h.from !== month), { from: month, cents: cents ?? 0 }];
}

// The look back at last month, once it's over: per pot with a budget, what it had and what went out.
// Over: raise the budget or keep it as a target. Well under three months running: lower it. Funds don't go
// over (a big month comes out of the fund), so they show what they kept or paid. Decisions are remembered per
// month in insight_status (`lookback:<month>:<pot>`), and `lookback:<month>` once it's done.
export function lookback() {
  const config = loadConfig();
  const { incomeCategories = ['Income'], transferCategory } = config;
  const periods = budgetPeriods();
  const finished = periods.filter((p) => p.end).slice(0, 6).reverse(); // oldest first
  const last = finished.at(-1);
  if (!last || !Object.values(config.budgets ?? {}).some((c) => c > 0)) return null;
  const net = new Map(); // category -> { month: net }
  for (const r of db.prepare(`SELECT booking_date, category, amount_cents FROM transactions
                              WHERE booking_date BETWEEN ? AND ? AND category IS NOT NULL AND category IS NOT ?`)
    .all(finished[0].start, last.end, transferCategory ?? null)) {
    if (incomeCategories.includes(r.category)) continue;
    const m = periodOf(periods, r.booking_date);
    const n = net.get(r.category) ?? {};
    n[m] = (n[m] ?? 0) - r.amount_cents;
    net.set(r.category, n);
  }
  const decided = new Map(db.prepare("SELECT id, status FROM insight_status WHERE id LIKE ?").all(`lookback:${last.month}%`).map((r) => [r.id, r.status]));
  const fundRows = new Map(funds().map((f) => [f.category, f.months.find((m) => m.month === last.month)]));
  const pots = config.categories.filter((c) => !incomeCategories.includes(c) && c !== transferCategory).map((category) => {
    const budget = budgetAt(config, category, last.month);
    if (!(budget > 0)) return null;
    const months = finished.map((p) => ({ month: p.month, budget: budgetAt(config, category, p.month), spent: Math.max(0, net.get(category)?.[p.month] ?? 0) }));
    const spent = months.at(-1).spent;
    const now = config.budgets?.[category] ?? null;
    const base = { category, budget, spent, now, months, overCount: months.filter((m) => m.budget > 0 && m.spent > m.budget).length };
    const row = fundRows.get(category);
    if (row) return { ...base, spent: row.spent, status: 'fund', fund: { kept: row.putIn - row.spent, fromFund: row.fromFund, balance: row.balance } };
    // Over: raise only to what would have been enough in 2 of every 3 months, so one big month (a one-off)
    // doesn't push the budget up. Well under: every month at most 70% of it, and at least 3 months to go by
    // (an irregular pot, €0 most months and then a big one, never counts as well under).
    const sorted = months.map((m) => m.spent).sort((a, b) => a - b);
    const typical = sorted[Math.ceil(sorted.length * 2 / 3) - 1];
    const slack = months.length >= 3 && months.every((m) => m.spent <= budget * 0.7);
    const status = spent > budget ? 'over' : slack ? 'slack' : 'within';
    const target = status === 'over' ? (roundUp(typical, 10) > budget ? roundUp(typical, 10) : null)
      : status === 'slack' ? roundUp(Math.max(sorted.at(-1), 500), 10) : null;
    // Already changed since then (on the Budget page): nothing left to decide.
    const decision = decided.get(`lookback:${last.month}:${category}`) ?? (now !== budget ? 'changed' : null);
    return { ...base, status, suggestion: target != null && target !== now ? target : null, decision };
  }).filter(Boolean).sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget));
  const t = overview(last.month).totals;
  return {
    month: last.month, start: last.start, end: last.end,
    done: decided.has(`lookback:${last.month}`),
    pots,
    open: pots.filter((e) => (e.status === 'over' || e.status === 'slack') && e.suggestion != null && !e.decision).length,
    totals: { income: t.income, spent: t.spent, saved: t.saved, left: t.left, kept: t.kept },
  };
}

// What the open tips could save in a year, without counting a pot twice (crept up and a big want).
// What acting on the open tips could save in a year. Fixed costs (needs: rent, energy, insurance) aren't
// counted: they're there to compare offers, not to cancel.
function potential(open) {
  const perPot = new Map();
  let other = 0;
  for (const i of open) {
    if (i.group === 'needs') continue;
    if (i.kind === 'creep' || i.kind === 'want') perPot.set(i.category, Math.max(perPot.get(i.category) ?? 0, i.yearlyCents));
    else if (i.kind !== 'duplicate') other += i.yearlyCents;
  }
  return other + [...perPot.values()].reduce((a, b) => a + b, 0);
}

// A one-line, numbers-only description of a finding for the AI.
function insightFacts(i, euros) {
  if (i.kind === 'subscription') return `€${(i.amountCents / 100).toFixed(2)} every ${i.interval}, ${i.count} charges since ${i.firstDate}`;
  if (i.kind === 'price') return `went from €${(i.fromCents / 100).toFixed(2)} to €${(i.amountCents / 100).toFixed(2)} a ${i.interval} (${i.since})`;
  if (i.kind === 'creep') return `€${euros(i.earlierCents)} a month before, €${euros(i.recentCents)} the last 3 months; most of the rise: ${i.drivers.map((d) => `${d.who} +€${euros(d.deltaCents)}/month`).join(', ')}`;
  if (i.kind === 'frequent') return `${i.count} payments in 90 days, €${(i.averageCents / 100).toFixed(2)} on average, €${euros(i.monthlyCents)} a month`;
  if (i.kind === 'duplicate') return `two payments of €${(i.amountCents / 100).toFixed(2)} on ${i.dates.join(' and ')}`;
  if (i.kind === 'want') return `€${euros(i.monthlyCents)} a month on average (${Math.round(i.shareOfIncome * 100)}% of income); its share of the wants overspend is €${euros(i.cutCents)} a month`;
  return '';
}

// Checks one savings plan from the UI; `name` is used in error messages.
function savingsPlanFrom(body, name) {
  const { mode } = body ?? {};
  if (!['fixed', 'average', 'off'].includes(mode)) throw new HttpError(400, `Pick a plan for ${name}`);
  const cents = (v) => (v == null || v === '' ? null : Math.round(Number(v)));
  const plan = { mode };
  if (mode === 'fixed') {
    plan.monthlyCents = cents(body.monthlyCents);
    if (!(plan.monthlyCents > 0)) throw new HttpError(400, `Type how much you put aside in ${name} a month`);
  }
  if (body.annualReturn != null) {
    plan.annualReturn = Number(body.annualReturn);
    if (!Number.isFinite(plan.annualReturn) || plan.annualReturn < -0.5 || plan.annualReturn > 0.5) throw new HttpError(400, `Expected return for ${name} must be between −50% and 50%`);
  }
  if (body.balanceCents != null && body.balanceCents !== '') {
    plan.balanceCents = cents(body.balanceCents);
    if (!Number.isFinite(plan.balanceCents) || plan.balanceCents < 0) throw new HttpError(400, `The balance of ${name} can’t be negative`);
    plan.balanceDate = /^\d{4}-\d{2}-\d{2}$/.test(body.balanceDate ?? '') ? body.balanceDate : today();
  }
  return plan;
}

// "Where could I cut?": the findings, with what you decided about each. A subscription you said you'd
// cancel is followed up: charged again since then, or gone (a win).
const insightAiCache = (globalThis.__budgetInsightAi ??= new Map()); // ids joined -> { ranked, summary }
export function insights({ skipSubscriptions = false } = {}) {
  const config = loadConfig();
  const { incomeCategories = ['Income'], transferCategory, budgetGroups = {} } = config;
  const rule = BUDGET_RULES[config.budgetRule] ? config.budgetRule : '50-30-20';
  const { expectedMonthlyCents } = incomeSettings(config);
  const incomeCents = expectedMonthlyCents ?? income().suggestedExpectedCents ?? 0;
  const found = findInsights({
    today: today(),
    periods: budgetPeriods(),
    transferCategory,
    isIncome: (c) => incomeCategories.includes(c),
    groupOf: (c) => groupOf(c, budgetGroups),
    income: incomeCents,
    wantShare: BUDGET_RULES[rule][1],
  });
  // Subscriptions you entered replace the ones found automatically for the same payments.
  if (!skipSubscriptions && (config.subscriptions ?? []).length) {
    const mine = subscriptions().list;
    const isMine = (f) => mine.some((s) => s.match && f.key.toLowerCase().includes(s.match)
      && (!s.byAmount || !f.byAmount || fitsSub(s, { amount_cents: -f.amountCents, booking_date: f.lastDate })));
    for (let i = found.length - 1; i >= 0; i--) if ((found[i].kind === 'subscription' || found[i].kind === 'price') && isMine(found[i])) found.splice(i, 1);
    for (const s of mine) {
      if (s.late) continue;
      found.push({
        id: `subscription:mine:${s.id}`, kind: 'subscription', key: s.name, category: s.category ?? 'Subscriptions', group: groupOf(s.category ?? 'Subscriptions', budgetGroups),
        interval: s.every, amountCents: s.amountCents, count: s.count, firstDate: s.charges.at(-1)?.date ?? s.lastDate ?? today(), lastDate: s.lastDate, yearlyCents: s.yearlyCents, mine: true,
      });
    }
    found.sort((a, b) => b.yearlyCents - a.yearlyCents);
  }
  const statuses = new Map(db.prepare('SELECT id, status, at FROM insight_status').all().map((r) => [r.id, r]));
  const lastCharge = db.prepare('SELECT max(booking_date) AS d FROM transactions WHERE amount_cents < 0 AND booking_date > ? AND (upper(counterparty) LIKE ? OR upper(description) LIKE ?)');
  const items = found.map((f) => {
    const st = statuses.get(f.id);
    const item = { ...f, status: st?.status ?? 'new', statusAt: st?.at ?? null };
    if (st?.status === 'cancelling') {
      const like = `%${f.key.toUpperCase()}%`;
      item.chargedSince = lastCharge.get(st.at, like, like).d;
    }
    return item;
  });
  // Subscriptions you were cancelling that no longer show up (they stopped) count as wins.
  const wins = [...statuses.values()].filter((st) => st.status === 'cancelling' && !found.some((f) => f.id === st.id))
    .map((st) => ({ id: st.id, key: st.id.split(':').slice(1).join(':'), since: st.at }));
  const open = items.filter((i) => i.status === 'new' || i.status === 'cancelling');
  const key = open.map((i) => i.id).sort().join('|');
  return {
    items,
    wins,
    income: incomeCents,
    rule,
    potentialCents: potential(open),
    ai: insightAiCache.get(key) ?? null,
  };
}

// ---------- subscriptions ----------
// Ones you enter yourself (`subscriptions` in the config), each linked to its payments by a bit of text that
// appears in them ("spotify"). From those payments: when it was last charged, for how much, and when the next
// one is due. Every amount is also shown per month and per year, whatever the interval.
const PER_YEAR = { week: 52, month: 12, quarter: 4, year: 1 };
const DAYS = { week: 7, month: 30.44, quarter: 91.3, year: 365.25 };
const subId = () => Math.random().toString(36).slice(2, 10);
const paymentsWith = (match, transferCategory) => (match ? db
  .prepare(`SELECT id, booking_date, amount_cents, counterparty, description, category FROM transactions
            WHERE amount_cents < 0 AND booking_date <= ? AND category IS NOT ?
              AND lower(coalesce(counterparty, '') || ' ' || coalesce(description, '')) LIKE ?
            ORDER BY booking_date DESC`)
  .all(today(), transferCategory ?? null, `%${match.toLowerCase()}%`) : []);

// fitsSub (in categories.js): a payment fits a subscription by amount and day, for payers that carry many things.
export { fitsSub };
// Linked by amount, a payment only counts when it's spaced like the interval (a yearly one can't come back
// two months later: that's something else at a similar price).
function chargesFor(sub, transferCategory) {
  const fits = paymentsWith(sub.match, transferCategory).filter((t) => fitsSub(sub, t));
  if (!sub.byAmount) return fits.slice(0, 24);
  const kept = [];
  for (const t of fits) if (!kept.length || daysBetween(t.booking_date, kept.at(-1).booking_date) >= DAYS[sub.every] * 0.7) kept.push(t);
  return kept.slice(0, 24);
}
const textOf = (t) => `${t.counterparty ?? ''} ${t.description ?? ''}`.toLowerCase();

export function subscriptions() {
  const config = loadConfig();
  const { transferCategory } = config;
  const list = (config.subscriptions ?? []).map((sub) => {
    const charges = chargesFor(sub, transferCategory);
    const last = charges[0] ?? null;
    const nextDate = last ? addDays(last.booking_date, Math.round(DAYS[sub.every])) : null;
    const lastCents = last ? -last.amount_cents : null;
    // Linked by name to a payer that carries many things (PayPal): offer to keep only this amount.
    const amounts = new Set(charges.map((t) => t.amount_cents));
    const sameAmount = charges.filter((t) => fitsSub({ ...sub, byAmount: true, day: null }, t));
    const mixed = !sub.byAmount && amounts.size > 3 && sameAmount.length
      ? { count: charges.length, low: Math.min(...charges.map((t) => -t.amount_cents)), high: Math.max(...charges.map((t) => -t.amount_cents)),
          day: sub.every === 'month' || sub.every === 'quarter' ? medianDay(sameAmount.map((t) => t.booking_date)) : null, matches: sameAmount.length }
      : null;
    return {
      ...sub,
      mixed,
      monthlyCents: Math.round((sub.amountCents * PER_YEAR[sub.every]) / 12),
      yearlyCents: sub.amountCents * PER_YEAR[sub.every],
      charges: charges.slice(0, 6).map((t) => ({ date: t.booking_date, cents: -t.amount_cents })),
      count: charges.length,
      lastDate: last?.booking_date ?? null,
      lastCents,
      category: sub.category ?? last?.category ?? null,
      nextDate,
      // The last charge differs from what you entered: a price change, or a different plan.
      priceChanged: lastCents != null && Math.abs(lastCents - sub.amountCents) > Math.max(10, sub.amountCents * 0.01),
      // Overdue by more than a week (or a month, for yearly ones): maybe cancelled, or paid another way.
      late: nextDate != null && daysBetween(nextDate, today()) > (sub.every === 'year' ? 30 : 7),
    };
  }).sort((a, b) => b.yearlyCents - a.yearlyCents);

  // Until the next payday (about a month after this one started): what's still coming.
  const current = budgetPeriods().find((p) => p.end == null);
  const nextPayday = current ? shiftMonth(current.start.slice(0, 7), 1) + current.start.slice(7) : addDays(today(), 30);
  const upcoming = list.filter((s) => s.nextDate && s.nextDate >= today() && s.nextDate <= nextPayday && !s.late)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));

  // Suggestions: payments that look like subscriptions and aren't on your list yet.
  const covered = (t) => list.some((s) => s.match && textOf(t).includes(s.match.toLowerCase()) && fitsSub(s, t));
  // "Not a subscription" hides a suggestion for good (the same as hiding it on Where to cut).
  const found = insights({ skipSubscriptions: true }).items.filter((i) => i.kind === 'subscription' && i.status !== 'hidden');
  const hidden = new Set(db.prepare("SELECT id FROM insight_status WHERE status = 'hidden'").all().map((r) => r.id));
  const suggestions = [];
  const suggest = (key, x) => {
    const match = shortMatch(key);
    const same = (s) => s.match && (match.includes(s.match) || s.match.includes(match));
    // A payer like PayPal can hold several: then each amount is its own suggestion.
    if (x.byAmount) {
      if (suggestions.some((y) => y.match === match && y.amountCents === x.amountCents)) return;
      if (list.some((s) => same(s) && (!s.byAmount || fitsSub(s, { amount_cents: -x.amountCents, booking_date: x.lastDate })))) return;
    } else if (suggestions.some((y) => y.match === match) || list.some(same)) return;
    const name = match.charAt(0).toUpperCase() + match.slice(1);
    suggestions.push({ name: x.byAmount ? `${name} ${(x.amountCents / 100).toLocaleString('nl-BE', { minimumFractionDigits: 2 })}` : name, match, ...x });
  };
  for (const i of found) suggest(i.key, { id: i.id, amountCents: i.amountCents, every: i.interval, category: i.category, lastDate: i.lastDate, byAmount: !!i.byAmount, day: i.day ?? null });
  // Plus anything in the Subscriptions pot that isn't covered yet.
  const inPot = db.prepare(`SELECT booking_date, amount_cents, counterparty, description, category FROM transactions
                                 WHERE amount_cents < 0 AND category = 'Subscriptions' AND booking_date >= ? ORDER BY booking_date DESC`)
    .all(addDays(today(), -120));
  for (const t of inPot) {
    const match = shortMatch(merchantKey(t));
    if (covered(t) || hidden.has(`subscription:match:${match}`) || suggestions.some((y) => y.match === match)) continue;
    suggest(merchantKey(t), { id: `subscription:match:${match}`, amountCents: -t.amount_cents, every: 'month', category: t.category, lastDate: t.booking_date });
  }

  return {
    list,
    monthlyCents: list.reduce((t, s) => t + s.monthlyCents, 0),
    yearlyCents: list.reduce((t, s) => t + s.yearlyCents, 0),
    upcoming,
    nextPayday,
    suggestions: suggestions.slice(0, 8),
    today: today(),
  };
}

// Payments to link a subscription to: merchants whose name or description contains the text.
export function subscriptionSearch(q) {
  const text = String(q ?? '').trim().toLowerCase();
  if (text.length < 2) return [];
  const { transferCategory } = loadConfig();
  const groups = new Map();
  for (const t of paymentsWith(text, transferCategory).slice(0, 24).concat(db
    .prepare(`SELECT id, booking_date, amount_cents, counterparty, description, category FROM transactions
              WHERE amount_cents < 0 AND category IS NOT ? AND lower(coalesce(counterparty, '') || ' ' || coalesce(description, '')) LIKE ?
              ORDER BY booking_date DESC LIMIT 200`).all(transferCategory ?? null, `%${text}%`))) {
    const key = merchantKey(t);
    const g = groups.get(key) ?? { key, count: 0, lastDate: t.booking_date, lastCents: -t.amount_cents, category: t.category, ids: new Set(), byCents: new Map() };
    if (!g.ids.has(t.id)) {
      g.ids.add(t.id); g.count += 1;
      const same = g.byCents.get(-t.amount_cents) ?? [];
      same.push(t.booking_date);
      g.byCents.set(-t.amount_cents, same);
    }
    groups.set(key, g);
  }
  // Amounts that come back (at least twice) with the day of the month they usually land on: for a payer
  // like PayPal, that's how you pick which of its payments is the subscription.
  const amountsOf = (byCents) => [...byCents].filter(([, dates]) => dates.length >= 2)
    .map(([cents, dates]) => ({ cents, count: dates.length, lastDate: dates[0], day: medianDay(dates) }))
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate)).slice(0, 8);
  return [...groups.values()].map(({ ids, byCents, ...g }) => ({
    ...g, name: tidyName(g.key), match: g.key.toLowerCase(), varied: byCents.size > 3, amounts: byCents.size > 3 ? amountsOf(byCents) : [],
  }))
    .sort((a, b) => b.count - a.count).slice(0, 8);
}

// The day of the month payments usually land on (days near the end of the month wrap to the next one).
function medianDay(dates) {
  const days = dates.map((d) => Number(d.slice(8, 10))).sort((a, b) => a - b);
  return days[Math.floor(days.length / 2)];
}

// What a subscription would link to, while you fill in the form.
export function subscriptionPreview(q) {
  const sub = { match: String(q.get('match') ?? '').trim().toLowerCase(), amountCents: Number(q.get('amountCents')) || 0,
    every: q.get('every') || 'month', byAmount: q.get('byAmount') === '1', day: Number(q.get('day')) || null };
  if (sub.match.length < 3) return { count: 0, charges: [] };
  const all = chargesFor({ ...sub }, loadConfig().transferCategory);
  return { count: all.length, charges: all.slice(0, 6).map((t) => ({ date: t.booking_date, cents: -t.amount_cents })) };
}

// A short bit of text that finds a merchant's payments: its first word ("streamly", "cloudco"), or the
// first two when the first is too short to be distinctive.
function shortMatch(key) {
  const words = key.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}.]+$/u, '').replace(/^[^\p{L}\p{N}]+/u, '')).filter(Boolean);
  const first = words[0] ?? key.toLowerCase();
  return first.length >= 4 && !/^(the|mol|sumup|www|bvba|nv)$/.test(first) ? first : words.slice(0, 2).join(' ');
}

const tidyName = (key) => (key === key.toUpperCase() ? key.toLowerCase().replace(/(^|[\s\-'/(.&])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : key);

function subscriptionFrom(body) {
  const name = String(body.name ?? '').trim();
  if (name.length < 2) throw new HttpError(400, 'Give the subscription a name');
  const amountCents = Math.round(Number(body.amountCents));
  if (!(amountCents > 0)) throw new HttpError(400, 'Type what it costs');
  if (!PER_YEAR[body.every]) throw new HttpError(400, 'Pick how often it’s charged');
  const match = String(body.match ?? '').trim().toLowerCase();
  if (match && match.length < 3) throw new HttpError(400, 'The text to find its payments needs at least 3 characters');
  const day = Math.round(Number(body.day));
  if (body.day != null && body.day !== '' && !(day >= 1 && day <= 31)) throw new HttpError(400, 'The day of the month is 1 to 31');
  return { id: body.id || subId(), name, amountCents, every: body.every, match: match || null, category: body.category || null,
    byAmount: !!(match && body.byAmount), day: match && day >= 1 && day <= 31 ? day : null };
}

export function reviewGroups() {
  applyRules();
  return groupUncategorised().map(({ key, txs }) => ({
    key,
    ids: txs.map((t) => t.id),
    count: txs.length,
    totalCents: txs.reduce((s, t) => s + t.amount_cents, 0),
    ibans: [...new Set(txs.map((t) => t.counterparty_iban).filter(Boolean).map(normIban))],
    examples: txs.slice(0, 3).map((t) => ({
      date: t.booking_date, cents: t.amount_cents, counterparty: t.counterparty, description: t.description,
    })),
  }));
}

export function accounts() {
  return db
    .prepare(`
      SELECT a.uid, a.bank, a.iban, a.name, a.currency, a.balance_cents, a.balance_date, a.last_synced,
             s.valid_until, (SELECT count(*) FROM transactions t WHERE t.account_uid = a.uid) AS tx_count
      FROM accounts a JOIN sessions s ON s.id = a.session_id
      ORDER BY a.uid LIKE 'sample-%', a.bank, a.name
    `)
    .all();
}

// Runs one of the scripts (sync, seed) in a child process, so an error can't take down the UI.
// In the desktop app, process.execPath is Electron itself: ELECTRON_RUN_AS_NODE makes it run as plain Node.
function runScript(script, args = []) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      // (.env only in a copy from source: the downloaded app keeps its settings in the data folder)
      [...(existsSync('.env') ? ['--env-file=.env'] : []), '--disable-warning=ExperimentalWarning', script, ...args],
      { timeout: 120_000, env: process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env },
      (error, stdout, stderr) => resolve({ ok: !error, output: (stdout + stderr).trim() }),
    );
  });
}

// What the Settings page shows: is Enable Banking set up, is a bank connected, sample data, AI, income.
async function setupState() {
  const { enableBanking, isConfigured } = await import('./settings.js');
  const { aiStatus } = await import('./ai.js');
  const eb = enableBanking();
  const ai = aiStatus();
  const config = loadConfig();
  return {
    enableBanking: { configured: isConfigured(eb), source: eb.source, appIdEnd: eb.appId ? eb.appId.slice(-6) : null, country: eb.country, redirectUrl: eb.redirectUrl },
    banks: db.prepare("SELECT DISTINCT bank FROM accounts WHERE uid NOT LIKE 'sample-%' ORDER BY bank").all().map((r) => r.bank),
    sample: db.prepare("SELECT count(*) AS n FROM accounts WHERE uid LIKE 'sample-%'").get().n > 0,
    transactions: db.prepare("SELECT count(*) AS n FROM transactions WHERE account_uid NOT LIKE 'sample-%'").get().n,
    ai: ai.configured,
    aiName: ai.provider === 'off' ? null : ai.name,
    aiProvider: ai.provider,
    aiChosen: ai.chosen,
    income: { expected: incomeSettings(config).expectedMonthlyCents, payers: (config.income?.salary ?? []).length },
    uncategorised: uncategorisedCount(),
  };
}

// The setup guide (/welcome) opens by itself on a first start: no bank of your own, no sample data, and the
// guide wasn't finished or skipped before.
export async function needsWelcome() {
  const { loadSettings } = await import('./settings.js');
  return !loadSettings().welcome?.done && db.prepare('SELECT count(*) AS n FROM accounts').get().n === 0;
}

// Runs the same sync as `npm run sync`.
const runSync = () => runScript('src/sync.js');

// ---------- routing ----------

export async function api(method, path, query, body) {
  const route = `${method} ${path}`;
  if (route === 'GET /api/overview') return overview(query.get('month'));
  if (route === 'GET /api/transactions') return transactions(Object.fromEntries(query));
  if (route === 'GET /api/review') return { groups: reviewGroups() };
  if (route === 'GET /api/accounts') return { accounts: accounts() };
  if (route === 'GET /api/config') return appConfig();
  if (route === 'POST /api/sync') return runSync();

  // The Settings page.
  if (route === 'GET /api/setup') return setupState();
  // The setup guide was finished or skipped: it no longer opens by itself (Settings still links to it).
  if (route === 'POST /api/setup/welcome') {
    const { loadSettings, saveSettings } = await import('./settings.js');
    saveSettings({ ...loadSettings(), welcome: { done: true } });
    return { ok: true };
  }
  if (route === 'POST /api/setup/enable-banking') {
    const { checkEnableBanking, saveEnableBanking } = await import('./settings.js');
    let creds;
    try { creds = checkEnableBanking(body ?? {}); } catch (err) { throw new HttpError(400, err.message); }
    // Only saved when Enable Banking accepts them: signed with the key, it lists the banks for the country.
    try {
      const { testCredentials } = await import('./enablebanking.js');
      await testCredentials(creds);
    } catch (err) {
      throw new HttpError(400, `Enable Banking didn’t accept these. Check the application ID and that the key file belongs to that application. (${String(err.message).slice(0, 200)})`);
    }
    saveEnableBanking(creds);
    return setupState();
  }
  // Choosing the AI (Settings → Sorting with AI). Keys are never sent back, only their last 4 characters.
  if (path === '/api/ai' || path.startsWith('/api/ai/')) {
    const ai = await import('./ai.js');
    const { loadSettings } = await import('./settings.js');
    // A key typed in now, or else the one saved for that provider (or set in the environment).
    const withSaved = (b) => {
      const s = loadSettings().ai ?? {};
      if (!Object.hasOwn(ai.PROVIDERS, b.provider)) throw new Error('Unknown AI provider');
      return { provider: b.provider, model: b.model || s.models?.[b.provider] || null, key: b.key || s.keys?.[b.provider] || process.env[ai.ENV_KEYS[b.provider]] || null,
        ollamaUrl: ai.checkOllamaUrl(b.ollamaUrl || s.ollamaUrl || 'http://127.0.0.1:11434') };
    };
    try {
      if (route === 'GET /api/ai') return ai.aiStatus();
      if (route === 'POST /api/ai') { ai.saveAi(body ?? {}); return ai.aiStatus(); }
      if (route === 'POST /api/ai/models') { const b = withSaved(body ?? {}); return { models: await ai.listModels(b.provider, b.key, b.ollamaUrl) }; }
      if (route === 'POST /api/ai/test') { await ai.testAi(withSaved(body ?? {})); return { ok: true }; }
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }

  // Updates: is there a newer version on GitHub, and (in the desktop app) update and restart.
  if (route === 'GET /api/update') {
    const { checkForUpdate } = await import('./updates.js');
    const { PROJECT } = await import('./paths.js');
    const info = await checkForUpdate(PROJECT);
    return { ...info, inApp: !!globalThis.__muntoApp };
  }
  if (route === 'POST /api/update') {
    if (!globalThis.__muntoApp) throw new HttpError(400, 'In the browser, update with git pull and restart npm run ui.');
    // Checked again here, not just by the button: only when there's an update and nothing of yours in the way.
    const { checkForUpdate } = await import('./updates.js');
    const { PROJECT } = await import('./paths.js');
    const info = await checkForUpdate(PROJECT);
    if (!info.canUpdate) throw new HttpError(409, info.reason ?? 'There’s nothing to update.');
    if (!globalThis.__muntoApp.startUpdate()) throw new HttpError(409, 'An update is already running.');
    return { ok: true };
  }

  if (route === 'POST /api/setup/sample') {
    const { hasOwnBank } = await import('./sample.js');
    if (!body?.remove && hasOwnBank()) throw new HttpError(409, 'Sample data is only for before your own bank is linked.');
    const result = await runScript('src/seed.js', body?.remove ? ['--remove'] : []);
    if (!result.ok) throw new HttpError(500, result.output.split('\n').at(-1) || 'The sample data couldn’t be made');
    return setupState();
  }
  // For the desktop app's menu-bar icon and notifications: how many transactions, how many to sort, and
  // when each bank's access ends.
  if (route === 'GET /api/app-status') {
    return {
      transactions: db.prepare('SELECT count(*) AS n FROM transactions').get().n,
      uncategorised: uncategorisedCount(),
      access: bankAccess(),
      lastSynced: lastSynced(),
    };
  }

  // Importing a bank's CSV export (Accounts → Import a CSV, see csvimport.js): look first, then save.
  if (route === 'POST /api/import/preview' || route === 'POST /api/import' || route === 'POST /api/import/remove') {
    const csv = await import('./csvimport.js');
    if (route === 'POST /api/import/preview') return csv.preview(String(body?.text ?? ''), body?.mapping ?? null);
    if (route === 'POST /api/import') return csv.importCsv({ text: String(body?.text ?? ''), mapping: body?.mapping ?? null, name: body?.name, bank: body?.bank });
    return csv.removeCsvAccount(String(body?.uid ?? ''));
  }

  // Linking a bank from the UI (see linking.js). Errors the person can act on come back as 400s.
  if (path.startsWith('/api/link/')) {
    const linking = await import('./linking.js');
    try {
      if (route === 'GET /api/link/banks') {
        // The end of your application id, so you open the right one in Enable Banking's control panel.
        const { appId } = (await import('./settings.js')).enableBanking();
        const app = appId ? `…${appId.slice(-6)}` : null;
        return { banks: await linking.banks(), app };
      }
      if (route === 'POST /api/link/start') return await linking.startLink(String(body?.bank ?? ''), { browser: !!body?.browser });
      if (route === 'POST /api/link/finish') return await linking.finishLink(linking.fromCallback(body?.callbackUrl));
      if (route === 'GET /api/link/status') return linking.linkStatus(query.get('state'));
    } catch (err) {
      if (err instanceof linking.LinkError) throw new HttpError(400, err.message);
      throw new HttpError(502, `Enable Banking: ${err.message}`);
    }
  }
  if (route === 'POST /api/features') return saveFeatures(body ?? {});

  if (route === 'GET /api/income') return income();

  if (route === 'POST /api/income/settings') {
    const changes = {};
    if ('paydayFromDay' in body) {
      const day = Number(body.paydayFromDay);
      if (!Number.isInteger(day) || day < 0 || day > 28) throw new HttpError(400, 'Pick a day between 1 and 28');
      changes.paydayFromDay = day;
    }
    if ('expectedMonthlyCents' in body) {
      const cents = body.expectedMonthlyCents == null ? null : Math.round(Number(body.expectedMonthlyCents));
      if (cents != null && !(cents > 0)) throw new HttpError(400, 'Expected income must be more than € 0');
      changes.expectedMonthlyCents = cents;
    }
    return saveIncomeSettings(changes);
  }

  // Salary (starts the month), other income, or not income (back into a pot).
  if (route === 'POST /api/income/source') {
    const { key, kind, category } = body;
    if (!key || !['salary', 'other', 'none'].includes(kind)) throw new HttpError(400, 'Missing payer or kind');
    const config = loadConfig();
    const { incomeCategories = ['Income'], transferCategory } = config;
    const txs = incomingFrom(key, transferCategory);
    if (txs.length === 0) throw new HttpError(404, `No payments from ${key}`);
    // Make the detected salary payer explicit before changing anything else.
    let { salary } = incomeSettings(config);
    if (salary.length === 0) {
      const detected = income().sources.find((s) => s.detected)?.key;
      if (detected) salary = [detected];
    }
    salary = salary.filter((k) => k !== key);
    if (kind === 'salary') salary.push(key);
    let rule = true;
    if (kind === 'none') {
      if (!category || incomeCategories.includes(category)) throw new HttpError(400, 'Pick the pot this money belongs in');
      rule = setIncomingCategory(key, txs, category);
    } else if (txs.some((t) => !incomeCategories.includes(t.category))) {
      rule = setIncomingCategory(key, txs, incomeCategories[0]);
    }
    saveIncomeSettings({ salary });
    return { ok: true, rule };
  }

  if (route === 'GET /api/savings') return savings();
  if (route === 'GET /api/budget') return budget();
  if (route === 'GET /api/insights') return insights();
  if (route === 'GET /api/subscriptions') return subscriptions();
  if (route === 'GET /api/subscriptions/search') return { results: subscriptionSearch(query.get('q')) };
  if (route === 'GET /api/subscriptions/preview') return subscriptionPreview(query);

  if (route === 'POST /api/subscriptions') {
    const sub = subscriptionFrom(body);
    const config = loadConfig();
    const list = config.subscriptions ?? [];
    const i = list.findIndex((x) => x.id === sub.id);
    if (i >= 0) list[i] = sub; else list.push(sub);
    config.subscriptions = list;
    saveConfig(config);
    applyRules(); // its payments go into its pot
    return sub;
  }

  const subMatch = path.match(/^\/api\/subscriptions\/([a-z0-9]+)$/);
  if (method === 'DELETE' && subMatch) {
    const config = loadConfig();
    config.subscriptions = (config.subscriptions ?? []).filter((x) => x.id !== subMatch[1]);
    saveConfig(config);
    applyRules();
    return { ok: true };
  }

  // Keep (it's worth it), hide, or "I'll cancel"; status null puts a tip back.
  if (route === 'POST /api/insights/status') {
    const id = String(body.id ?? '');
    if (!id) throw new HttpError(400, 'Missing tip');
    if (body.status == null) db.prepare('DELETE FROM insight_status WHERE id = ?').run(id);
    else if (['kept', 'hidden', 'cancelling'].includes(body.status)) {
      db.prepare('INSERT INTO insight_status (id, status, at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, at = excluded.at').run(id, body.status, today());
    } else throw new HttpError(400, 'Unknown status');
    return { ok: true };
  }

  // Claude ranks and phrases the open tips. Sent: merchant or pot names and amounts, no descriptions or IBANs.
  if (route === 'POST /api/insights/ai') {
    const { rankInsights, aiConfigured, aiMissingMessage } = await import('./suggest.js');
    if (!aiConfigured()) throw new HttpError(400, aiMissingMessage());
    const data = insights();
    const open = data.items.filter((i) => i.status === 'new' || i.status === 'cancelling');
    if (!open.length) return { ranked: [], summary: 'Nothing to look at right now.' };
    const euros = (c) => Math.round(c / 100);
    try {
      const result = await rankInsights({
        incomeEuros: euros(data.income),
        rule: data.rule,
        findings: open.map((i) => ({
          id: i.id, kind: i.kind, name: i.kind === 'creep' || i.kind === 'want' ? i.category : i.key, pot: i.category, group: i.group,
          yearlyEuros: euros(i.yearlyCents),
          facts: insightFacts(i, euros),
        })),
      });
      insightAiCache.set(open.map((i) => i.id).sort().join('|'), result);
      return result;
    } catch (err) {
      throw new HttpError(502, `AI tips failed: ${err.message}`);
    }
  }

  // Save budgets: { budgets: { category: cents | null } }; null removes one.
  if (route === 'POST /api/budget') {
    const config = loadConfig();
    if (body.rule != null) {
      if (!BUDGET_RULES[body.rule]) throw new HttpError(400, 'Unknown budget rule');
      config.budgetRule = body.rule;
    }
    if (body.groups) {
      const groups = { ...(config.budgetGroups ?? {}) };
      for (const [category, group] of Object.entries(body.groups)) {
        if (!config.categories.includes(category) || !['needs', 'wants'].includes(group)) throw new HttpError(400, `Can’t make ${category} a ${group}`);
        groups[category] = group;
      }
      config.budgetGroups = groups;
    }
    // Each change counts from this month on, so earlier months keep the budget they had.
    const month = budgetPeriods().find((p) => p.end == null)?.month;
    for (const [category, value] of Object.entries(body.budgets ?? {})) {
      if (!config.categories.includes(category)) throw new HttpError(400, `Unknown pot "${category}"`);
      const cents = value == null ? null : Math.round(Number(value));
      if (cents != null && (!Number.isFinite(cents) || cents < 0)) throw new HttpError(400, `A budget for ${category} can’t be negative`);
      setBudget(config, category, cents, month);
    }
    saveConfig(config);
    return { budgets: config.budgets };
  }

  // The look back at last month: { month, category, action: 'raise' | 'lower' | 'keep', cents? }, or
  // { month, action: 'done' } to put the month away.
  if (route === 'POST /api/lookback') {
    const { month, category, action } = body ?? {};
    if (!/^\d{4}-\d{2}$/.test(month ?? '')) throw new HttpError(400, 'Which month?');
    const save = (id, status) => db.prepare('INSERT INTO insight_status (id, status, at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, at = excluded.at').run(id, status, today());
    if (action === 'done') { save(`lookback:${month}`, 'done'); return { ok: true }; }
    const config = loadConfig();
    if (!config.categories.includes(category)) throw new HttpError(400, `Unknown pot "${category}"`);
    if (action === 'raise' || action === 'lower') {
      const cents = Math.round(Number(body.cents));
      if (!(cents > 0)) throw new HttpError(400, `Type a budget for ${category}`);
      setBudget(config, category, cents, budgetPeriods().find((p) => p.end == null)?.month);
      saveConfig(config);
    } else if (action !== 'keep') throw new HttpError(400, 'Unknown choice');
    save(`lookback:${month}:${category}`, action === 'raise' ? 'raised' : action === 'lower' ? 'lowered' : 'kept');
    return { ok: true };
  }

  // Make a pot a fund, or change what was already set aside: { category, startCents, budgetCents? }.
  // { category, stop: true } turns it back into a normal pot.
  if (route === 'POST /api/funds') {
    const config = loadConfig();
    const { category } = body ?? {};
    if (!config.categories.includes(category)) throw new HttpError(400, `Unknown pot "${category}"`);
    const all = { ...(config.funds ?? {}) };
    if (body.stop) {
      delete all[category];
    } else {
      const month = budgetPeriods().find((p) => p.end == null)?.month;
      if (!month) throw new HttpError(400, 'Sync your transactions first');
      if (body.budgetCents != null) {
        const cents = Math.round(Number(body.budgetCents));
        if (!Number.isFinite(cents) || cents <= 0) throw new HttpError(400, `Type how much goes into ${category} a month`);
        setBudget(config, category, cents, month);
      }
      const budget = config.budgets?.[category] ?? 0;
      if (!(budget > 0)) throw new HttpError(400, `Give ${category} a monthly budget first: that's what goes into the fund`);
      const startCents = body.startCents == null || body.startCents === '' ? 0 : Math.round(Number(body.startCents));
      if (!Number.isFinite(startCents)) throw new HttpError(400, 'Type what you already set aside, or leave it empty');
      const f = all[category];
      all[category] = f
        ? { ...f, startCents, history: body.budgetCents != null ? [...(f.history ?? []).filter((h) => h.from !== month), { from: month, cents: budget }] : f.history }
        : { since: month, startDate: today(), startCents, history: [{ from: month, cents: budget }] };
    }
    config.funds = all;
    saveConfig(config);
    return { funds: funds() };
  }

  // Ask Claude for a budget. Only the monthly totals per pot are sent, never transactions.
  if (route === 'POST /api/budget/suggest') {
    const { suggestBudget, aiConfigured, aiMissingMessage } = await import('./suggest.js');
    if (!aiConfigured()) throw new HttpError(400, aiMissingMessage());
    const b = budget();
    const euros = (c) => Math.round(c / 100);
    try {
      const groups = body.groups ?? {};
      const [needs, wants, save] = BUDGET_RULES[body.rule] ?? BUDGET_RULES[b.rule];
      const result = await suggestBudget({
        pots: b.pots.map((e) => ({ category: e.category, kind: e.kind, group: groups[e.category] ?? e.group, months: e.months.map(euros) })),
        incomeEuros: euros(b.income),
        savingsEuros: euros(b.plannedSavings),
        rule: { needs, wants, savings: save },
      });
      return { budgets: Object.fromEntries(result.budgets.map((x) => [x.category, { cents: x.euros * 100, reason: x.reason }])), summary: result.summary };
    } catch (err) {
      throw new HttpError(502, `Budget suggestion failed: ${err.message}`);
    }
  }

  // Save the plans of several savings accounts at once: { plans: { key: { mode, monthlyCents, annualReturn,
  // balanceCents, balanceDate } } }. Mode "off" leaves an account out of the plan and the projection.
  if (route === 'POST /api/savings/plans') {
    if (!body.plans || typeof body.plans !== 'object') throw new HttpError(400, 'Nothing to save');
    const config = loadConfig();
    const ownNames = config.ownAccountNames ?? {};
    const next = { ...(config.savingsPlan ?? {}) };
    for (const [key, input] of Object.entries(body.plans)) next[key] = savingsPlanFrom(input, ownNames[key] ?? key);
    config.savingsPlan = next;
    saveConfig(config);
    return { savingsPlan: next };
  }

  // Savings goals: { name, targetCents, byDate?, accounts? (keys; empty = all accounts in the plan) }.
  if (route === 'POST /api/savings/goals') {
    const name = String(body.name ?? '').trim();
    if (name.length < 2) throw new HttpError(400, 'Give the goal a name');
    const targetCents = Math.round(Number(body.targetCents));
    if (!(targetCents > 0)) throw new HttpError(400, 'Type how much you want to have');
    const byDate = /^\d{4}-\d{2}(-\d{2})?$/.test(body.byDate ?? '') ? body.byDate.slice(0, 7) : null;
    if (byDate && byDate <= today().slice(0, 7)) throw new HttpError(400, 'Pick a month in the future');
    const goal = { id: body.id || subId(), name, targetCents, byDate, accounts: Array.isArray(body.accounts) ? body.accounts.map(String) : [] };
    const config = loadConfig();
    const goals = config.savingsGoals ?? [];
    const i = goals.findIndex((g) => g.id === goal.id);
    if (i >= 0) goals[i] = goal; else goals.push(goal);
    config.savingsGoals = goals;
    saveConfig(config);
    return goal;
  }
  const goalMatch = path.match(/^\/api\/savings\/goals\/([a-z0-9]+)$/);
  if (method === 'DELETE' && goalMatch) {
    const config = loadConfig();
    config.savingsGoals = (config.savingsGoals ?? []).filter((g) => g.id !== goalMatch[1]);
    saveConfig(config);
    return { ok: true };
  }

  if (route === 'POST /api/income/one-off') {
    const result = db.prepare('UPDATE transactions SET one_off = ? WHERE id = ? AND amount_cents > 0').run(body.oneOff ? 1 : 0, String(body.id ?? ''));
    if (result.changes === 0) throw new HttpError(404, 'No such payment');
    return { ok: true };
  }

  if (route === 'POST /api/categories') {
    const name = String(body.name ?? '').trim();
    if (name.length < 2) throw new HttpError(400, 'Category name is too short');
    addCategory(name);
    return loadConfig();
  }

  if (route === 'POST /api/rules') {
    const text = String(body.match ?? '').trim();
    if (text.length < 3) throw new HttpError(400, 'A match needs at least 3 characters');
    if (!body.category) throw new HttpError(400, 'Pick a category');
    const amountCents = body.amountCents == null ? null : Number(body.amountCents);
    if (amountCents != null && !(Number.isInteger(amountCents) && amountCents > 0)) throw new HttpError(400, 'The amount should be more than €0');
    addRule(text, body.category, { amountCents });
    return loadConfig();
  }

  const ruleMatch = path.match(/^\/api\/rules\/(\d+)$/);
  if (method === 'DELETE' && ruleMatch) {
    deleteRule(Number(ruleMatch[1]));
    return loadConfig();
  }

  // Undo a delete: the rule goes back where it was, since the first match wins.
  if (route === 'POST /api/rules/restore') {
    const { index, rule } = body;
    if (!rule || typeof rule.match !== 'string' || typeof rule.category !== 'string' || !Number.isInteger(index) || index < 0) {
      throw new HttpError(400, 'Nothing to put back');
    }
    restoreRule(index, rule);
    return loadConfig();
  }

  // Set (or clear, with category: null) the category of specific transactions by hand.
  if (route === 'POST /api/transactions/category') {
    if (!Array.isArray(body.ids) || body.ids.length === 0) throw new HttpError(400, 'No transactions given');
    setManualCategory(body.ids, body.category ?? null);
    return { ok: true };
  }

  // Review: categorise a merchant group as a rule, by hand, or as transfers to your own accounts. With
  // orManual, a rule whose text isn't in every transaction sorts them by hand instead. Returns what it
  // did as `undo`, which POST /api/review/undo takes back.
  if (route === 'POST /api/review') {
    const { ids, category, match, orManual } = body;
    let { mode } = body;
    if (!Array.isArray(ids) || ids.length === 0 || !category) throw new HttpError(400, 'Missing transactions or category');
    const getTx = db.prepare('SELECT * FROM transactions WHERE id = ?');
    const txs = ids.map((id) => getTx.get(id)).filter(Boolean);
    if (mode === 'own') {
      const ibans = [...new Set(txs.map((t) => t.counterparty_iban).filter(Boolean))];
      if (ibans.length === 0) throw new HttpError(400, 'These transactions have no IBAN');
      addOwnIbans(ibans);
      return { ok: true, mode, undo: { mode, ibans } };
    }
    if (mode === 'rule' && !matchesAll(String(match ?? ''), txs)) {
      if (!orManual) throw new HttpError(400, `"${match}" doesn't appear in all of these transactions`);
      mode = 'manual';
    }
    if (mode === 'rule') {
      addRule(match, category);
      return { ok: true, mode, undo: { mode, match: escapeRegex(String(match).trim().toLowerCase()), category } };
    }
    setManualCategory(ids, category);
    return { ok: true, mode: 'manual', undo: { mode: 'manual', ids } };
  }

  // Takes back one sort from Unsorted: the rule it added (its last copy), the hand-sorted category, or
  // the IBANs it marked as your own.
  if (route === 'POST /api/review/undo') {
    const { mode, match, category, ids, ibans } = body;
    const texts = (list) => Array.isArray(list) && list.length > 0 && list.every((x) => typeof x === 'string');
    if (mode === 'rule' && typeof match === 'string' && typeof category === 'string') {
      const index = loadConfig().rules.findLastIndex((r) => r.match === match && r.category === category && r.amountCents == null);
      if (index >= 0) deleteRule(index);
    } else if (mode === 'own' && texts(ibans)) {
      removeOwnIbans(ibans);
    } else if (mode === 'manual' && texts(ids)) {
      setManualCategory(ids, null);
    } else {
      throw new HttpError(400, 'Nothing to undo');
    }
    return { ok: true };
  }

  // Accept several review groups at once (e.g. "Accept all AI suggestions"). Each group becomes a rule
  // when its merchant name appears in all its transactions, and is categorised by hand otherwise.
  if (route === 'POST /api/review/bulk') {
    if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, 'Nothing to save');
    const getTx = db.prepare('SELECT * FROM transactions WHERE id = ?');
    const config = loadConfig();
    let rules = 0;
    for (const { key, ids, category } of body.items) {
      if (!category || !Array.isArray(ids) || ids.length === 0) continue;
      if (!config.categories.includes(category)) throw new HttpError(400, `Unknown category "${category}"`);
      const txs = ids.map((id) => getTx.get(id)).filter(Boolean);
      const match = String(key ?? '').toLowerCase();
      if (matchesAll(match, txs)) {
        config.rules.push({ match: escapeRegex(match.trim()), category });
        rules++;
      } else {
        setManualCategory(ids, category);
      }
    }
    saveConfig(config);
    applyRules();
    return { ok: true, rules, saved: body.items.length };
  }

  if (route === 'POST /api/suggest') {
    const { suggestCategories, suggestionInput, aiConfigured, aiMissingMessage } = await import('./suggest.js');
    if (!aiConfigured()) throw new HttpError(400, aiMissingMessage());
    // Only ask about merchants we haven't asked about yet this run, so revisiting the page costs nothing.
    const groups = groupUncategorised();
    const missing = groups.filter((g) => !suggestionCache.has(g.key));
    try {
      if (missing.length) {
        const { aiSettings } = await import('./ai.js');
        const fresh = await suggestCategories(suggestionInput(missing, { amounts: aiSettings().sendAmounts }), loadConfig().categories);
        for (const [key, value] of fresh) suggestionCache.set(key, value);
      }
      const suggestions = Object.fromEntries(groups.filter((g) => suggestionCache.has(g.key)).map((g) => [g.key, suggestionCache.get(g.key)]));
      return { suggestions };
    } catch (err) {
      throw new HttpError(502, `AI suggestions failed: ${err.message}`);
    }
  }

  throw new HttpError(404, `No route for ${route}`);
}

// Config plus what the UI needs to know about the machine (is Claude Code installed?).
export async function appConfig() {
  const { aiConfigured, aiName } = await import('./suggest.js');
  const { aiSettings, aiStatus } = await import('./ai.js');
  const ai = aiSettings();
  const sentTo = aiStatus().providers.find((p) => p.id === ai.provider)?.sentTo ?? null;
  const config = loadConfig();
  return { ...config, features: featureSettings(config), aiConfigured: aiConfigured(), aiName: aiName(), aiAuto: ai.auto, aiSendsAmounts: ai.sendAmounts, aiSentTo: sentTo };
}

// Each bank of your own and when its access ends (its earliest consent), soonest first. Not the sample data,
// and not accounts imported from a CSV (no access to end).
export const bankAccess = () => db.prepare(`SELECT a.bank, min(s.valid_until) AS until FROM accounts a JOIN sessions s ON s.id = a.session_id
  WHERE s.id != ? AND a.uid NOT LIKE 'csv-%' GROUP BY a.bank ORDER BY until`).all(SAMPLE_SESSION);
export const lastSynced = () => db.prepare('SELECT max(last_synced) AS t FROM accounts').get().t;
export const uncategorisedCount = () => db.prepare('SELECT count(*) AS n FROM transactions WHERE category IS NULL').get().n;
