import { budget } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Budget } from '@/components/budget.jsx';

export const metadata = { title: 'Budget' };

export default function BudgetPage() {
  return <Budget data={plain(budget())} />;
}
