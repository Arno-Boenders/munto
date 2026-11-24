// The app running by itself: a menu-bar icon, a sync when it opens and every morning (also with the window
// closed), notifications for new transactions and for bank access that's about to end, and backups.
import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, powerMonitor, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { accessNotifications, loadAppState, localDay as today, saveAppState } from '../src/reminders.js';

const MORNING = 7; // the daily sync runs from 07:00 (or as soon as the Mac is awake after that)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Apps opened from Finder get only the bare system PATH, so they wouldn't find `claude` (in /opt/homebrew/bin
// or ~/.local/bin). Ask your login shell for its PATH once, the way your terminal sees it.
export function usePathFromLoginShell() {
  if (process.platform === 'win32') return;
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin'), join(homedir(), '.claude', 'local')];
  let fromShell = '';
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__PATH__%s__END__" "$PATH"'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    fromShell = out.match(/__PATH__(.*)__END__/)?.[1] ?? '';
  } catch { /* fall back to the usual places */ }
  const parts = [...fromShell.split(':'), ...(process.env.PATH ?? '').split(':'), ...extra].filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(':');
}

export function startBackground({ origin, showWindow, root, checkForUpdate, lastUpdate }) {
  // app-state.json in the data folder, shared with the scheduled sync (npm run schedule).
  const state = loadAppState();
  const save = () => saveAppState(state);
  const call = (path, method = 'GET') => fetch(`${origin}${path}`, { method, headers: { 'content-type': 'application/json', 'x-munto-token': process.env.MUNTO_TOKEN }, body: method === 'POST' ? '{}' : undefined }).then((r) => r.json());
  let syncing = false;
  let status = null; // the last /api/app-status

  function notify(title, body, path) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => showWindow(path));
    n.show();
  }

  async function sync({ auto = false } = {}) {
    if (syncing) return;
    syncing = true;
    refreshMenu('Syncing…');
    try {
      const before = await call('/api/app-status');
      if (!before.access.length) return; // no bank linked yet
      if (auto) {
        // A copy of your data before the first sync of the day.
        const { backup, backedUpToday } = await import('../src/backup.js');
        if (!backedUpToday()) backup('daily');
      }
      const result = await call('/api/sync', 'POST');
      status = await call('/api/app-status');
      if (auto) { state.lastAutoSync = today(); save(); }
      const added = status.transactions - before.transactions;
      // Notifications can show on the lock screen: a fixed sentence, the details stay in the app.
      if (!result.ok) {
        notify('The sync didn’t work', 'Open Munto to see why and try again.', '/accounts');
      } else if (added > 0 && (auto || !BrowserWindow.getFocusedWindow())) {
        notify(plural(added, 'new transaction'), status.uncategorised ? `${status.uncategorised} to sort` : 'All sorted by your rules', status.uncategorised ? '/review' : '/');
      }
      warnAboutAccess();
    } catch (err) {
      if (auto) notify('The sync didn’t work', 'Open Munto to see why and try again.', '/accounts');
    } finally {
      syncing = false;
      refreshMenu();
    }
  }

  // Once a day, from a week before a bank's access ends (src/reminders.js).
  function warnAboutAccess() {
    for (const n of accessNotifications(status?.access ?? [], state)) notify(n.title, n.body, '/accounts');
    save();
  }

  // Every 10 minutes, and when the Mac wakes up: is the morning sync due?
  const morning = () => { if (state.lastAutoSync !== today() && new Date().getHours() >= MORNING) sync({ auto: true }); };
  setInterval(morning, 10 * 60_000);
  powerMonitor.on('resume', () => setTimeout(morning, 15_000)); // give the network a moment
  // On open: sync unless it did in the last half hour.
  call('/api/app-status').then((s) => {
    status = s;
    refreshMenu();
    const recent = s.lastSynced && Date.now() - Date.parse(s.lastSynced) < 30 * 60_000;
    if (process.env.MUNTO_MORNING_NOW) sync({ auto: true }); // for checks: the morning sync, right away
    else if (!recent) sync({ auto: new Date().getHours() >= MORNING && state.lastAutoSync !== today() });
    else warnAboutAccess();
  }).catch(() => {});

  // ---------- updates from GitHub ----------
  let update = null; // the last check
  async function lookForUpdate() {
    try { update = await checkForUpdate(); } catch { return; }
    // One notification per new version. A downloaded copy gets a new version by downloading it.
    if (update.download && state.notifiedUpdate !== `release:${update.download.version}`) {
      notify(`Munto ${update.download.version} is out`, 'Download it from Settings.', '/settings#updates');
      state.notifiedUpdate = `release:${update.download.version}`; save();
    }
    const latest = update.behind ? `${update.upstream}@${update.behind}:${update.changes[0]}` : null;
    if (latest && state.notifiedUpdate !== latest) {
      notify('An update for Munto', `${plural(update.behind, 'change')}${update.changes[0] ? `, like “${update.changes[0]}”` : ''}. Update from Settings.`, '/settings#updates');
      state.notifiedUpdate = latest; save();
    }
    refreshMenu();
  }
  setTimeout(lookForUpdate, 60_000);
  setInterval(lookForUpdate, 24 * 60 * 60_000);
  // After an update: did it work?
  if (lastUpdate) {
    setTimeout(() => notify(lastUpdate.ok ? 'Munto is up to date' : 'The update didn’t work',
      lastUpdate.ok ? `Updated to ${lastUpdate.to}.` : 'You’re still on the version you had. Details are in update.log in your data folder.', lastUpdate.ok ? '/' : '/settings#updates'), 3000);
  }

  // ---------- the menu-bar icon and the app menu ----------
  // macOS: a black outline it colours itself (trayTemplate.png, with @2x). Windows and Linux: the app icon,
  // since a black outline would vanish on a dark taskbar.
  const tray = new Tray(process.platform === 'darwin'
    ? join(root, 'build', 'trayTemplate.png')
    : nativeImage.createFromPath(join(root, 'build', 'icon.png')).resize({ width: process.platform === 'win32' ? 16 : 22, height: process.platform === 'win32' ? 16 : 22, quality: 'best' }));
  if (process.platform !== 'darwin') tray.on('click', () => showWindow()); // a click opens it; right-click shows the menu
  tray.setToolTip('Munto');

  async function backupNow() {
    const { backup } = await import('../src/backup.js');
    const dir = backup('manual');
    if (dir) shell.showItemInFolder(join(dir, 'budget.db'));
  }
  const showDataFolder = () => shell.openPath(app.getPath('userData'));

  function refreshMenu(busy) {
    const line = busy ?? (status
      ? `${status.lastSynced ? `Synced ${new Date(status.lastSynced).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Not synced yet'}${status.uncategorised ? ` · ${status.uncategorised} to sort` : ''}`
      : 'Munto');
    // Starting at login: macOS and Windows (where it starts with --hidden); not available on Linux.
    const loginItems = app.isPackaged && process.platform !== 'linux';
    const loginArgs = process.platform === 'win32' ? { path: process.execPath, args: ['--hidden'] } : {};
    const atLogin = loginItems && app.getLoginItemSettings(loginArgs).openAtLogin;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: line, enabled: false },
      { type: 'separator' },
      { label: 'Open Munto', click: () => showWindow() },
      ...(status?.uncategorised ? [{ label: `Sort ${status.uncategorised}…`, click: () => showWindow('/review') }] : []),
      { label: 'Sync now', enabled: !syncing, click: () => sync() },
      ...(update?.behind ? [{ label: `Update available (${plural(update.behind, 'change')})…`, click: () => showWindow('/settings#updates') }]
        : update?.download ? [{ label: `Munto ${update.download.version} is out…`, click: () => showWindow('/settings#updates') }] : []),
      { type: 'separator' },
      { label: 'Open at login', type: 'checkbox', checked: atLogin, enabled: loginItems,
        toolTip: loginItems ? 'Starts quietly and syncs every morning' : 'Only for the installed app (npm run app:install), on macOS and Windows',
        click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, ...loginArgs }); refreshMenu(); } },
      { label: 'Back up your data', click: backupNow },
      { label: 'Show data folder', click: showDataFolder },
      { type: 'separator' },
      { label: 'Quit Munto', role: 'quit' },
    ]));
    tray.setTitle(status?.uncategorised ? String(status.uncategorised) : ''); // a small count next to the icon
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [
      { label: 'Sync now', accelerator: 'CmdOrCtrl+Shift+S', click: () => sync() },
      { type: 'separator' },
      { label: 'Back up your data', click: backupNow },
      { label: 'Show data folder', click: showDataFolder },
      { type: 'separator' },
      { role: 'close' },
    ] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
  refreshMenu();
  return { sync };
}

