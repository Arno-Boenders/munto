import { redirect } from 'next/navigation';

// The page was called Setup: older links (notifications, bookmarks) still land on Settings.
export default function SetupPage() {
  redirect('/settings');
}
