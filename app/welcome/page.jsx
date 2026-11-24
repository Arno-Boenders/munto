import { api, income } from '@/src/api.js';
import { plain } from '@/lib/format.js';
import { Welcome } from '@/components/welcome.jsx';

export const metadata = { title: 'Set up' };

export default async function WelcomePage() {
  return <Welcome state={plain(await api('GET', '/api/setup', new URLSearchParams(), null))} income={plain(income())} />;
}
