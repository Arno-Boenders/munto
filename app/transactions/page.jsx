import { budgetPeriods, transactions } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Transactions } from '@/components/transactions.jsx';

export const metadata = { title: 'Transactions' };
const FILTERS = ['month', 'category', 'q', 'direction', 'iban', 'day'];

export default async function TransactionsPage({ searchParams }) {
  const params = await searchParams;
  const filters = Object.fromEntries(FILTERS.map((k) => [k, typeof params[k] === 'string' ? params[k] : '']));
  const months = budgetPeriods().map((p) => p.month);
  return <Transactions filters={filters} months={months} rows={plain(transactions(filters))} />;
}
