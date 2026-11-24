import { reviewGroups } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Review } from '@/components/review.jsx';

export const metadata = { title: 'Unsorted' };

export default async function ReviewPage() {
  return <Review groups={plain(reviewGroups())} />;
}
