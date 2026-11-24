// Where your data lives: one folder of the app's own, shared by `npm run ui`, the command-line scripts and
// the desktop app. MUNTO_DATA_DIR overrides it; DB_PATH and CONFIG_PATH override single files (tests).
//   macOS    ~/Library/Application Support/Munto
//   Windows  %APPDATA%\Munto
//   Linux    $XDG_DATA_HOME/munto (~/.local/share/munto)
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Your bank data is for you only: the folder is 700 and the files in it 600, so other accounts on the same
// computer can't read them. (No-ops on Windows, where the user profile already keeps them private.)
export function privateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* not ours to change */ }
}
export function privateFile(file) {
  try { chmodSync(file, 0o600); } catch { /* not there yet, or not ours */ }
}

function folderFor(name, env, platform, home) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', name);
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), name);
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), name.toLowerCase());
}

export function dataDir(env = process.env, platform = process.platform, home = homedir()) {
  const own = env.MUNTO_DATA_DIR || env.ENVELOPES_DATA_DIR; // (the second from when the app was called Envelopes)
  return own || folderFor('Munto', env, platform, home);
}

// Where the data lived while the app was called Envelopes; null when you chose your own folder.
export function oldDataDir(env = process.env, platform = process.platform, home = homedir()) {
  return env.MUNTO_DATA_DIR || env.ENVELOPES_DATA_DIR ? null : folderFor('Envelopes', env, platform, home);
}

// Before the data folder, the database and config lived in the project (data/budget.db,
// config/categories.json). Moved once: copied into the folder, the copy checked to be the same size, and
// the old file renamed to "….moved" so it stays as a backup and is never used by mistake.
// Several processes can start at the same moment (the build's workers), so the copy goes to a temporary
// file first and only then gets its name: nobody ever opens a half-copied database.
export function moveOldFile(from, to) {
  // The kept backup is as private as the data folder (also for one moved by an older version, which left
  // it readable by other accounts).
  privateFile(`${from}.moved`);
  if (existsSync(to) || !existsSync(from)) return false;
  privateDir(dirname(to));
  const tmp = `${to}.copying-${process.pid}`;
  copyFileSync(from, tmp);
  privateFile(tmp);
  if (statSync(tmp).size !== statSync(from).size) throw new Error(`Copying ${from} to ${to} went wrong; nothing was moved`);
  renameSync(tmp, to);
  try { renameSync(from, `${from}.moved`); } catch (err) { if (err.code !== 'ENOENT') throw err; } // another process got there first
  privateFile(`${from}.moved`);
  console.log(`Moved ${from} to ${to} (the old file is kept as ${from}.moved)`);
  return true;
}

// The app was called Envelopes, and so was its data folder. Copied once into the Munto folder, as long as
// that holds none of your data yet (the desktop app may have made it already, for its own browser files).
// The old folder stays as it was, as a backup, with a note in it saying where your data went. Like
// moveOldFile, the copy is made under a temporary name first, so several processes starting at once never
// see half a folder.
const YOURS = ['budget.db', 'categories.json', 'settings.json'];
export function copyOldDataDir(from, to) {
  if (!from || !YOURS.some((f) => existsSync(join(from, f))) || YOURS.some((f) => existsSync(join(to, f)))) return false;
  const tmp = `${to}.copying-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  // Not the browser's lock files, which only mean something to the process that made them.
  cpSync(from, tmp, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, filter: (src) => !basename(src).startsWith('Singleton') });
  try {
    const differs = (f) => existsSync(join(from, f)) && statSync(join(tmp, f)).size !== statSync(join(from, f)).size;
    if (YOURS.some(differs)) throw new Error(`Copying ${from} to ${to} went wrong; nothing was moved`);
    privateDir(tmp);
    if (!existsSync(to)) renameSync(tmp, to);
    else for (const name of readdirSync(tmp)) if (!existsSync(join(to, name))) renameSync(join(tmp, name), join(to, name));
  } catch (err) {
    if (!YOURS.some((f) => existsSync(join(to, f)))) throw err;
    return false; // another process got there first
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  try {
    writeFileSync(join(from, 'MOVED TO MUNTO.txt'), `This app is now called Munto, and your data moved to\n${to}\n\nThis folder is the copy from before the move. You can delete it once Munto works for you.\n`);
  } catch { /* only a note */ }
  console.log(`Copied your data from ${from} to ${to} (the old folder stays as a backup)`);
  return true;
}

// The data folder, after the one-time copy from the old one. Every process checks once.
let ready = null;
export function dataFolder() {
  if (ready) return ready;
  const dir = dataDir();
  copyOldDataDir(oldDataDir(), dir);
  return (ready = dir);
}

export function dbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const path = join(dataFolder(), 'budget.db');
  moveOldFile(join(PROJECT, 'data', 'budget.db'), path);
  return path;
}

export function configPath() {
  if (process.env.CONFIG_PATH) return process.env.CONFIG_PATH;
  const path = join(dataFolder(), 'categories.json');
  moveOldFile(join(PROJECT, 'config', 'categories.json'), path);
  return path;
}
