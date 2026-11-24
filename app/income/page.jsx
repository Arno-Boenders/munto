import { income } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Income } from '@/components/income.jsx';

export const metadata = { title: 'Income' };

export default function IncomePage() {
  return <Income data={plain(income())} />;
}
