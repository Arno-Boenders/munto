// Backups of your data: budget.db and categories.json, copied into backups/ in the data folder. The database
// is copied by SQLite itself (VACUUM INTO), so the copy is consistent even while the app is using it.
// Daily ones (before the first sync of the day) and the ones before an update are pruned to the last 14;
// the ones you make yourself are kept.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPath, dbPath, privateDir, privateFile } from './paths.js';

const KEEP = 14;
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export function backupsDir() {
  return join(dirname(dbPath()), 'backups');
}

// reason: 'daily' | 'update' | 'manual'. Returns the folder it wrote, or null when there's nothing to back up.
export function backup(reason = 'manual', now = new Date()) {
  const db = dbPath();
  if (!existsSync(db)) return null;
  const dir = join(backupsDir(), `${stamp(now)}-${reason}`);
  privateDir(backupsDir());
  privateDir(dir);
  const conn = new DatabaseSync(db, { readOnly: true });
  try { conn.exec(`VACUUM INTO '${join(dir, 'budget.db').replace(/'/g, "''")}'`); } finally { conn.close(); }
  privateFile(join(dir, 'budget.db'));
  const config = configPath();
  if (existsSync(config)) { copyFileSync(config, join(dir, 'categories.json')); privateFile(join(dir, 'categories.json')); }
  prune();
  return dir;
}

// Has a daily backup been made today already?
export function backedUpToday(now = new Date()) {
  const today = stamp(now).slice(0, 10);
  return existsSync(backupsDir()) && readdirSync(backupsDir()).some((n) => n.startsWith(today) && n.endsWith('-daily'));
}

function prune() {
  const automatic = readdirSync(backupsDir()).filter((n) => /-(daily|update)$/.test(n)).sort();
  for (const old of automatic.slice(0, Math.max(0, automatic.length - KEEP))) rmSync(join(backupsDir(), old), { recursive: true, force: true });
}
