// The daily sync for Munto in the browser (npm run ui), started by your computer's own scheduler (set up with
// `npm run schedule`, see schedule.js). It backs up your data, syncs, and says in a notification what came in
// and when a bank's access is about to end. Skipped when a sync ran in the last two hours, such as the desktop
// app's morning sync, so the two never both sync.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROJECT, dbPath, privateFile } from './paths.js';
import { backedUpToday, backup } from './backup.js';
import { accessNotifications, loadAppState, localDay, saveAppState } from './reminders.js';
import { notify } from './notify.js';
import { safe } from './terminal.js';
import { db } from './db.js';
import { bankAccess, lastSynced, uncategorisedCount } from './api.js';

const RECENT_MS = 2 * 60 * 60_000;
const KEEP_LINES = 500;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const transactions = () => db.prepare('SELECT count(*) AS n FROM transactions').get().n;

// sync.log in the data folder: what each run did, the last 500 lines. Each line is cleaned (src/terminal.js),
// so text from a bank can't add lines of its own or put control characters in the file.
const logFile = join(dirname(dbPath()), 'sync.log');
function log(text) {
  const old = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [];
  const lines = String(text).split(/\r?\n/).filter(Boolean).map((l) => `${new Date().toISOString()} ${safe(l)}`);
  writeFileSync(logFile, [...old, ...lines].slice(-KEEP_LINES).join('\n') + '\n', { mode: 0o600 });
  privateFile(logFile);
}

const runSync = () => new Promise((resolve) => {
  execFile(process.execPath, ['--disable-warning=ExperimentalWarning', join(PROJECT, 'src', 'sync.js')],
    { cwd: PROJECT, timeout: 5 * 60_000, env: process.env },
    (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}${stderr}`.trim() }));
});

if (!bankAccess().length) {
  log('No bank linked yet: nothing to sync.');
  process.exit(0);
}

const state = loadAppState();
const last = lastSynced();
if (last && Date.now() - Date.parse(last) < RECENT_MS) {
  log(`Already synced at ${last}: skipped.`);
} else {
  if (!backedUpToday()) backup('daily');
  const before = transactions();
  const result = await runSync();
  log(result.output || (result.ok ? 'Synced.' : 'The sync failed.'));
  state.lastAutoSync = localDay(); // the desktop app, if it's running too, then skips its morning sync
  // Notifications can show on the lock screen: a fixed sentence, the details stay in the app.
  if (!result.ok) {
    notify('The sync didn’t work', 'Open Munto to see why and try again.');
  } else {
    const added = transactions() - before;
    const unsorted = uncategorisedCount();
    if (added > 0) notify(plural(added, 'new transaction'), unsorted ? `${unsorted} to sort` : 'All sorted by your rules');
  }
}
for (const n of accessNotifications(bankAccess(), state)) {
  notify(n.title, n.body);
  log(safe(n.title)); // one line, even if the bank's name had a line break in it
}
saveAppState(state);
