import { insights } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Cut } from '@/components/cut.jsx';

export const metadata = { title: 'Where to cut' };

export default function CutPage() {
  return <Cut data={plain(insights())} />;
}
