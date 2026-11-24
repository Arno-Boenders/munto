import { accounts } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Accounts } from '@/components/accounts.jsx';

export const metadata = { title: 'Accounts' };

export default async function AccountsPage({ searchParams }) {
  const { connect, import: importing } = await searchParams;
  return <Accounts accounts={plain(accounts())} connect={connect === '1'} importing={importing === '1'} />;
}
