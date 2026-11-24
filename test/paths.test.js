// The data folder: one place per platform, the one-time move out of the project folder, and the one-time
// copy from when the app was called Envelopes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyOldDataDir, dataDir, moveOldFile, oldDataDir } from '../src/paths.js';

test('one data folder per platform, or the one you set', () => {
  // (Built with join, so the separators match whichever system runs the test.)
  assert.equal(dataDir({}, 'darwin', '/Users/me'), join('/Users/me', 'Library', 'Application Support', 'Munto'));
  assert.equal(dataDir({ APPDATA: '/Roaming' }, 'win32', '/me'), join('/Roaming', 'Munto'));
  assert.equal(dataDir({}, 'linux', '/home/me'), join('/home/me', '.local', 'share', 'munto'));
  assert.equal(dataDir({ XDG_DATA_HOME: '/data' }, 'linux', '/home/me'), join('/data', 'munto'));
  assert.equal(dataDir({ MUNTO_DATA_DIR: '/tmp/x' }, 'darwin', '/Users/me'), '/tmp/x');
  assert.equal(dataDir({ ENVELOPES_DATA_DIR: '/tmp/y' }, 'darwin', '/Users/me'), '/tmp/y', 'the old name still works');
});

test('the old file is copied once, then kept as .moved; the data folder is never overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'munto-paths-'));
  mkdirSync(join(dir, 'project'));
  const from = join(dir, 'project', 'budget.db');
  const to = join(dir, 'Munto', 'budget.db');
  assert.equal(moveOldFile(from, to), false, 'nothing to move');
  writeFileSync(from, 'my money');
  assert.equal(moveOldFile(from, to), true);
  assert.equal(readFileSync(to, 'utf8'), 'my money');
  assert.ok(!existsSync(from));
  assert.equal(readFileSync(`${from}.moved`, 'utf8'), 'my money', 'the old one stays as a backup');
  assert.deepEqual(readdirSync(join(dir, 'Munto')), ['budget.db'], 'no temporary copy left behind');
  writeFileSync(from, 'something else');
  assert.equal(moveOldFile(from, to), false);
  assert.equal(readFileSync(to, 'utf8'), 'my money');
});

test('the data folder and what is moved into it are private', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'munto-perm-'));
  mkdirSync(join(dir, 'project'));
  const from = join(dir, 'project', 'budget.db');
  writeFileSync(from, 'x', { mode: 0o644 });
  const to = join(dir, 'Munto', 'budget.db');
  moveOldFile(from, to);
  assert.equal(statSync(join(dir, 'Munto')).mode & 0o777, 0o700);
  assert.equal(statSync(to).mode & 0o777, 0o600);
  assert.equal(statSync(`${from}.moved`).mode & 0o777, 0o600, 'the kept backup too');
});

test('a backup kept by an older version is made private too', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'munto-perm-'));
  const from = join(dir, 'budget.db');
  writeFileSync(`${from}.moved`, 'x', { mode: 0o644 });
  writeFileSync(join(dir, 'already.db'), 'x');
  assert.equal(moveOldFile(from, join(dir, 'already.db')), false);
  assert.equal(statSync(`${from}.moved`).mode & 0o777, 0o600);
});

test('the folder from when the app was called Envelopes', () => {
  assert.equal(oldDataDir({}, 'darwin', '/Users/me'), join('/Users/me', 'Library', 'Application Support', 'Envelopes'));
  assert.equal(oldDataDir({}, 'linux', '/home/me'), join('/home/me', '.local', 'share', 'envelopes'));
  assert.equal(oldDataDir({ MUNTO_DATA_DIR: '/tmp/x' }, 'darwin', '/Users/me'), null, 'your own folder is never swapped for another');
});

test('the old data folder is copied once; the old one stays as a backup with a note', () => {
  const dir = mkdtempSync(join(tmpdir(), 'munto-rename-'));
  const from = join(dir, 'Envelopes');
  const to = join(dir, 'Munto');
  assert.equal(copyOldDataDir(from, to), false, 'nothing to copy');
  mkdirSync(join(from, 'backups', '2026-10-01-daily'), { recursive: true });
  writeFileSync(join(from, 'budget.db'), 'my money');
  writeFileSync(join(from, 'categories.json'), '{}');
  writeFileSync(join(from, 'backups', '2026-10-01-daily', 'budget.db'), 'yesterday');
  assert.equal(copyOldDataDir(from, to), true);
  assert.equal(readFileSync(join(to, 'budget.db'), 'utf8'), 'my money');
  assert.equal(readFileSync(join(to, 'backups', '2026-10-01-daily', 'budget.db'), 'utf8'), 'yesterday');
  assert.equal(readFileSync(join(from, 'budget.db'), 'utf8'), 'my money', 'the old folder is left as it was');
  assert.ok(existsSync(join(from, 'MOVED TO MUNTO.txt')));
  assert.deepEqual(readdirSync(dir).sort(), ['Envelopes', 'Munto'], 'no temporary copy left behind');
  writeFileSync(join(from, 'budget.db'), 'changed later');
  assert.equal(copyOldDataDir(from, to), false, 'once Munto has your data, it is never overwritten');
  assert.equal(readFileSync(join(to, 'budget.db'), 'utf8'), 'my money');
});

test('the desktop app may have made the Munto folder already: your data still comes over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'munto-rename-'));
  const from = join(dir, 'Envelopes');
  const to = join(dir, 'Munto');
  mkdirSync(join(from, 'Browser'), { recursive: true });
  writeFileSync(join(from, 'budget.db'), 'my money');
  writeFileSync(join(from, 'Browser', 'Cookies'), 'old');
  mkdirSync(join(to, 'Browser'), { recursive: true });
  writeFileSync(join(to, 'Browser', 'Cookies'), 'new');
  assert.equal(copyOldDataDir(from, to), true);
  assert.equal(readFileSync(join(to, 'budget.db'), 'utf8'), 'my money');
  assert.equal(readFileSync(join(to, 'Browser', 'Cookies'), 'utf8'), 'new', 'what is already there stays');
  assert.deepEqual(readdirSync(dir).sort(), ['Envelopes', 'Munto']);
});

test('the copy is private too', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'munto-rename-'));
  mkdirSync(join(dir, 'Envelopes'));
  writeFileSync(join(dir, 'Envelopes', 'budget.db'), 'x');
  copyOldDataDir(join(dir, 'Envelopes'), join(dir, 'Munto'));
  assert.equal(statSync(join(dir, 'Munto')).mode & 0o777, 0o700);
});
