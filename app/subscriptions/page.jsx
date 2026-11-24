import { subscriptions } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Subscriptions } from '@/components/subscriptions.jsx';

export const metadata = { title: 'Subscriptions' };

export default function SubscriptionsPage() {
  return <Subscriptions data={plain(subscriptions())} />;
}
