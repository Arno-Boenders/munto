// Bank access ends after 90–180 days (PSD2). From a week before, Munto says so: on the Overview, and as a
// notification from the desktop app or the scheduled sync, once a day per bank. app-state.json in the data
// folder remembers what was said when, so the app and the scheduled sync don't both say it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dbPath, privateFile } from './paths.js';

export const WARN_DAYS = 7;
export const localDay = (d = new Date()) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD, local time
export const daysLeft = (iso, now = new Date()) => Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000);
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

// access: [{ bank, until }] -> the banks whose access ends within a week or has ended, soonest first.
export function endingSoon(access, now = new Date()) {
  return access
    .map((a) => ({ bank: a.bank, until: a.until, days: daysLeft(a.until, now) }))
    .filter((a) => a.days <= WARN_DAYS)
    .sort((x, y) => x.days - y.days)
    .map((a) => ({ ...a, title: a.days <= 0 ? `${a.bank} access has ended` : `${a.bank} access ends on ${fmtDay(a.until)}` }));
}

// The notifications due now: ending soon, and not said today yet. Marks them as said in `state`.
export function accessNotifications(access, state, now = new Date()) {
  state.warned ??= {};
  const today = localDay(now);
  const due = endingSoon(access, now).filter((a) => state.warned[a.bank] !== today);
  for (const a of due) state.warned[a.bank] = today;
  return due.map((a) => ({ title: a.title, body: 'Renew it on the Accounts page to keep syncing.' }));
}

const statePath = () => join(dirname(dbPath()), 'app-state.json');
export function loadAppState() {
  try { return JSON.parse(readFileSync(statePath(), 'utf8')); } catch { return {}; }
}
export function saveAppState(state) {
  writeFileSync(statePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
  privateFile(statePath());
}
