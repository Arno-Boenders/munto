// Spending per category per month.
//   npm run report               last 3 months
//   npm run report -- --months 6
import { loadConfig } from './categories.js';
import { db } from './db.js';

const monthsArg = process.argv.indexOf('--months');
const monthCount = monthsArg > -1 ? Number(process.argv[monthsArg + 1]) : 3;
const { transferCategory, incomeCategories = ['Income'] } = loadConfig();

const months = db
  .prepare(`SELECT DISTINCT substr(booking_date, 1, 7) AS m FROM transactions WHERE booking_date <= date('now') ORDER BY m DESC LIMIT ?`)
  .all(monthCount)
  .map((r) => r.m)
  .reverse();
if (months.length === 0) {
  console.log('No transactions yet. Run `npm run sync` (or `npm run seed` for sample data).');
  process.exit(0);
}

const rows = db
  .prepare(`
    SELECT coalesce(category, '(uncategorised)') AS category, substr(booking_date, 1, 7) AS month, sum(amount_cents) AS cents
    FROM transactions
    WHERE substr(booking_date, 1, 7) >= ? AND booking_date <= date('now') AND category IS NOT ?
    GROUP BY 1, 2
  `)
  .all(months[0], transferCategory ?? null);

const table = new Map(); // category -> month -> cents
for (const { category, month, cents } of rows) {
  if (!table.has(category)) table.set(category, new Map());
  table.get(category).set(month, cents);
}

const money = (cents) => (cents ? (cents / 100).toFixed(2) : '-').padStart(11);
const line = (label, values) => console.log(label.padEnd(20) + values.map(money).join(''));
const totalFor = (category) => months.reduce((sum, m) => sum + (table.get(category)?.get(m) ?? 0), 0);

console.log(''.padEnd(20) + months.map((m) => m.padStart(11)).join(''));
const categories = [...table.keys()].sort((a, b) => totalFor(a) - totalFor(b)); // biggest spending first
const incomeRows = categories.filter((c) => incomeCategories.includes(c));
const spendingRows = categories.filter((c) => !incomeCategories.includes(c));

for (const c of spendingRows) line(c, months.map((m) => table.get(c).get(m)));
console.log('-'.repeat(20 + 11 * months.length));
const sumMonth = (cats, m) => cats.reduce((sum, c) => sum + (table.get(c).get(m) ?? 0), 0);
line('Total expenses', months.map((m) => sumMonth(spendingRows, m)));
for (const c of incomeRows) line(c, months.map((m) => table.get(c).get(m)));
line('Net', months.map((m) => sumMonth(categories, m)));
if (transferCategory) console.log(`\n(${transferCategory} between your own accounts are left out.)`);
