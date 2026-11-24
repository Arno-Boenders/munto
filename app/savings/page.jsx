import { savings } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Savings } from '@/components/savings.jsx';

export const metadata = { title: 'Savings' };

export default function SavingsPage() {
  return <Savings data={plain(savings())} />;
}
