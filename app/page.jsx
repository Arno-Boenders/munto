import { redirect } from 'next/navigation';
import { lookback, needsWelcome, overview, uncategorisedCount } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Overview } from '@/components/overview.jsx';

export const metadata = { title: { absolute: 'Overview · Munto' } };

export default async function OverviewPage({ searchParams }) {
  // A first start opens the setup guide instead of an empty Overview.
  if (await needsWelcome()) redirect('/welcome');
  const { month } = await searchParams;
  return <Overview data={plain(overview(month))} unsorted={uncategorisedCount()} lookback={plain(lookback())} />;
}
