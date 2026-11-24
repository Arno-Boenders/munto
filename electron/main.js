// The desktop app: Electron starts the same Next.js app as `npm run ui`, in production mode, on a free port
// on 127.0.0.1, and opens a window on it. Nothing else changes: the pages, the API and the database code
// are the web app's. background.js adds the menu-bar icon, the morning sync, notifications and backups.
// Run with `npm run app` (builds the UI into .next-app/ first), or install it with `npm run app:install`.
import { app, BrowserWindow, nativeTheme, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { startBackground, usePathFromLoginShell } from './background.js';
import { enableBanking } from '../src/settings.js';
import { dataDir, dataFolder } from '../src/paths.js';
import { checkForUpdate } from '../src/updates.js';
import { lastUpdateResult, startUpdate } from './updates.js';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
app.setName('Munto'); // also the app's own data folder: ~/Library/Application Support/Munto
// Windows only shows notifications for an app with an ID (the same as the installed app's).
if (process.platform === 'win32') app.setAppUserModelId('app.munto');
// A data folder of your own (MUNTO_DATA_DIR) holds the app's own files too, not just your data.
if (process.env.MUNTO_DATA_DIR) app.setPath('userData', dataDir());
// Bring the data over from when the app was called Envelopes, before the window's browser files land in the
// new folder (see src/paths.js).
dataFolder();
// Your database and config live in that folder (see src/paths.js); the window's own browser files (cache,
// local storage) go in a subfolder, so the data folder holds only your files.
app.setPath('sessionData', join(app.getPath('userData'), 'Browser'));
process.chdir(root); // the data layer uses paths relative to the project (config/, data/)
// Its own build folder, so the app never touches the one `npm run ui` is using (next.config.mjs reads this).
process.env.NEXT_DIST_DIR ??= '.next-app';
// A secret for this run: only the app's own window and background sync know it, and the server answers
// nothing without it (see proxy.js), so other accounts on this Mac can't read your data through the port.
const token = randomBytes(32).toString('hex');
process.env.MUNTO_TOKEN = token;
export const withToken = (headers = {}) => ({ ...headers, 'x-munto-token': token });

async function startServer() {
  const { default: next } = await import('next');
  const nextApp = next({ dev: false, dir: root, hostname: '127.0.0.1' });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();
  const server = createServer((req, res) => handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); // 0: any free port
  return `http://127.0.0.1:${server.address().port}`;
}

// Nothing but the app itself loads inside its windows. Other links open in the normal browser, and only
// plain web links (http/https): never file:, or schemes that would start another program.
const sameOrigin = (raw, origin) => { try { return new URL(raw).origin === origin; } catch { return false; } };
const isWebLink = (raw) => { try { return ['http:', 'https:'].includes(new URL(raw).protocol); } catch { return false; } };
// Connecting a bank: Enable Banking's page opens in a login window of the app. There, bank pages may load
// (https only), and when the bank sends you back to EB_REDIRECT_URL the app catches that address before it
// loads, closes the window and finishes the link: no local https server or certificate needed.
const loginWindows = new WeakSet();
const isBankStart = (raw) => { try { const u = new URL(raw); return u.protocol === 'https:' && (u.hostname === 'enablebanking.com' || u.hostname.endsWith('.enablebanking.com')); } catch { return false; } };
const isRedirect = (raw) => { const r = enableBanking().redirectUrl; try { const a = new URL(raw); const b = new URL(r); return a.origin === b.origin && a.pathname === b.pathname; } catch { return false; } };
function caughtRedirect(contents, origin, target) {
  const win = BrowserWindow.fromWebContents(contents);
  win?.close();
  // The page waiting in the main window sees the result through /api/link/status.
  fetch(`${origin}/api/link/finish`, { method: 'POST', headers: withToken({ 'content-type': 'application/json' }), body: JSON.stringify({ callbackUrl: target }) })
    .catch(() => { /* shown on the Accounts page */ });
}

function guard(contents, origin) {
  contents.setWindowOpenHandler(({ url: target }) => {
    if (!loginWindows.has(contents) && isBankStart(target)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 520, height: 780, title: 'Connect your bank', autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      } };
    }
    if (isWebLink(target) && !sameOrigin(target, origin)) shell.openExternal(target);
    return { action: 'deny' };
  });
  contents.on('did-create-window', (child) => loginWindows.add(child.webContents));
  const keepInApp = (event, target) => {
    if (loginWindows.has(contents)) {
      if (isRedirect(target)) { event.preventDefault(); caughtRedirect(contents, origin, target); return; }
      if (!/^https:/i.test(target)) event.preventDefault(); // bank pages only, never file: or app links
      return;
    }
    if (sameOrigin(target, origin)) return;
    event.preventDefault();
    if (isWebLink(target)) shell.openExternal(target);
  };
  contents.on('will-navigate', keepInApp);
  contents.on('will-frame-navigate', (event) => keepInApp(event, event.url));
  contents.on('will-redirect', keepInApp);
}

let mainWindow = null;
async function openWindow(url) {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 500, minHeight: 600,
    title: 'Munto', backgroundColor: nativeTheme.shouldUseDarkColors ? '#120a16' : '#ece5ef', show: false, icon: join(root, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  mainWindow = win;
  win.on('closed', () => { mainWindow = null; });
  win.once('ready-to-show', () => win.show());
  await win.loadURL(url);
  // For checks: MUNTO_SHOT=/path.png saves what the window shows, once the page has settled.
  if (process.env.MUNTO_SHOT) {
    setTimeout(async () => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(process.env.MUNTO_SHOT, (await win.webContents.capturePage()).toPNG());
      console.log('screenshot saved');
    }, 2500);
  }
}

app.whenReady().then(async () => {
  // Find `claude` and other tools the way your terminal does (apps from Finder get a bare PATH).
  usePathFromLoginShell();
  // Our icon in the Dock while running from source (`npm run app`); a packaged app has it built in.
  const icon = join(root, 'build', 'icon.png');
  if (process.platform === 'darwin' && !app.isPackaged && existsSync(icon)) app.dock.setIcon(icon);
  // For the API (it runs in this process): the Update button.
  globalThis.__muntoApp = { startUpdate: () => startUpdate(root) };
  const url = await startServer();
  console.log(`Munto is running at ${url}`);
  const origin = new URL(url).origin;
  app.on('web-contents-created', (_event, contents) => guard(contents, origin)); // every window and frame
  // The window's requests to the app carry the secret; requests to anyone else (the bank pages) never do,
  // and neither does anything a bank page in a login window asks of the app's address.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    const fromLogin = details.webContents && loginWindows.has(details.webContents);
    callback({ requestHeaders: fromLogin ? details.requestHeaders : withToken(details.requestHeaders) });
  });
  // Pages get no browser permissions (camera, location, notifications, reading the clipboard, opening other
  // apps...), except copying text from the app itself. Bank pages in login windows get none at all.
  const allowed = (permission, requestingUrl) => permission === 'clipboard-sanitized-write' && sameOrigin(requestingUrl, origin);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(allowed(permission, details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => allowed(permission, requestingOrigin));

  // Open (or bring forward) the window, on a page of the app.
  const showWindow = (path) => {
    if (process.platform === 'darwin') app.dock?.show();
    if (mainWindow) {
      if (path) mainWindow.loadURL(`${url}${path}`);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else openWindow(`${url}${path ?? ''}`);
  };
  // Opened at login: start quietly in the menu bar or tray (no window, no Dock icon) and sync in the
  // background. macOS says so itself; on Windows the login item starts it with --hidden.
  const atLogin = process.platform === 'darwin' ? app.getLoginItemSettings().wasOpenedAtLogin : process.argv.includes('--hidden');
  if (atLogin) app.dock?.hide();
  else await openWindow(url);
  startBackground({ origin, showWindow, root, checkForUpdate: () => checkForUpdate(root), lastUpdate: lastUpdateResult() });
  app.on('activate', () => showWindow());
});
// Closing the window keeps Munto running in the menu bar (the tray on Windows and Linux), to sync in the
// morning; quit from its menu.
app.on('window-all-closed', () => {});
