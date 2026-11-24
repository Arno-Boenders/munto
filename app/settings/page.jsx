import { api } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Setup } from '@/components/setup.jsx';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  return <Setup state={plain(await api('GET', '/api/setup', new URLSearchParams(), null))} />;
}
