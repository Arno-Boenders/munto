// Backups: a consistent copy of the database and the config, private, and the automatic ones pruned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setup } from './fixture.js';

const { dir } = await setup({ today: '2026-10-16', txs: [{ date: '2026-10-01', cents: -4000, who: 'DELHAIZE', category: 'Groceries' }] });
const { backup, backedUpToday, backupsDir } = await import('../src/backup.js');

test('a backup holds the database and the config, readable only by you', () => {
  const folder = backup('manual', new Date(2026, 9, 16, 7, 30, 0));
  assert.equal(folder, join(dir, 'backups', '2026-10-16_073000-manual'));
  assert.deepEqual(readdirSync(folder).sort(), ['budget.db', 'categories.json']);
  const copy = new DatabaseSync(join(folder, 'budget.db'), { readOnly: true });
  assert.equal(copy.prepare('SELECT count(*) AS n FROM transactions').get().n, 1);
  if (process.platform !== 'win32') {
    assert.equal(statSync(folder).mode & 0o777, 0o700);
    assert.equal(statSync(join(folder, 'budget.db')).mode & 0o777, 0o600);
  }
});

test('one daily backup a day; automatic ones keep the last 14, yours are kept', () => {
  assert.equal(backedUpToday(new Date(2026, 9, 16)), false, 'a manual one is not the daily one');
  for (let d = 1; d <= 20; d++) backup('daily', new Date(2026, 9, d, 7, 0, 0));
  assert.equal(backedUpToday(new Date(2026, 9, 16)), true);
  const names = readdirSync(backupsDir());
  assert.equal(names.filter((n) => n.endsWith('-daily')).length, 14);
  assert.ok(names.includes('2026-10-16_073000-manual'), 'the one you made is kept');
  assert.ok(!names.includes('2026-10-01_070000-daily'), 'the oldest daily ones are gone');
});
