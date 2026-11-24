import { overview } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { TrendsPage } from '@/components/trends.jsx';

export const metadata = { title: 'Trends' };

export default async function Page({ searchParams }) {
  const { month } = await searchParams;
  return <TrendsPage data={plain(overview(month))} />;
}
