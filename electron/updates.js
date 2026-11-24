// The desktop app's Update button: hands over to scripts/update.mjs (it backs up, pulls, rebuilds and reopens
// the app, and goes back to the old version if anything fails). Checking for a new version is src/updates.js.
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dbPath, oldDataDir } from '../src/paths.js';

// Hands over to the updater and quits; the updater waits until the app has gone, then reopens it.
let updating = false;
export function startUpdate(root) {
  if (updating) return false;
  updating = true;
  // What to open again afterwards: the .app on macOS, the program itself on Windows and Linux.
  const appPath = !app.isPackaged ? null : process.platform === 'darwin' ? process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, '') : process.execPath;
  const child = spawn(process.execPath, [join(root, 'scripts', 'update.mjs'), '--wait', String(process.pid), ...(appPath ? ['--reopen', appPath] : [])], {
    cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.unref();
  setTimeout(() => app.quit(), 300);
  return true;
}

// After an update: what happened (read once, then removed).
export function lastUpdateResult() {
  // The update that renamed the app wrote this in the old folder (it was still running the old code).
  const files = [dirname(dbPath()), oldDataDir()].filter(Boolean).map((dir) => join(dir, 'update-result.json')).filter(existsSync);
  if (!files.length) return null;
  try { return JSON.parse(readFileSync(files[0], 'utf8')); } catch { return null; } finally { for (const f of files) rmSync(f, { force: true }); }
}
