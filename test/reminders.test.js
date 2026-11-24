// Bank access reminders (shared by the Overview, the desktop app and the scheduled sync), the scheduler
// files `npm run schedule` writes, and the notification commands. Nothing is installed or shown here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './fixture.js';

const { api, db, dir } = await setup({ today: '2026-11-18' });
const { accessNotifications, endingSoon } = await import('../src/reminders.js');
const { command, launchdPlist, systemdUnits, windowsTask } = await import('../src/schedule.js');
const { notifyCommand } = await import('../src/notify.js');

const now = new Date('2026-11-18T09:00:00');
const access = [
  { bank: 'Bank A', until: '2026-12-31T00:00:00' }, // weeks away
  { bank: 'Bank B', until: '2026-11-21T09:00:00' }, // 3 days
  { bank: 'Bank C', until: '2026-11-17T09:00:00' }, // yesterday
];

test('from a week before access ends, soonest first, and once it has ended', () => {
  assert.deepEqual(endingSoon(access, now).map((a) => [a.bank, a.days, a.title]), [
    ['Bank C', -1, 'Bank C access has ended'],
    ['Bank B', 3, 'Bank B access ends on 21 November'],
  ]);
});

test('a notification once a day per bank, then again the next day', () => {
  const state = {};
  assert.equal(accessNotifications(access, state, now).length, 2);
  assert.equal(accessNotifications(access, state, new Date('2026-11-18T18:00:00')).length, 0, 'not twice the same day');
  assert.equal(accessNotifications(access, state, new Date('2026-11-19T08:00:00')).length, 2, 'again the next day');
});

test('the Overview and the app status leave out the sample data', () => {
  db.exec("UPDATE sessions SET valid_until = '2026-11-20T00:00:00' WHERE id = 's1'");
  db.exec("INSERT INTO sessions (id, bank, valid_until) VALUES ('sample-session', 'Sample bank', '2026-11-19T00:00:00')");
  db.exec("INSERT INTO accounts (uid, session_id, bank, currency) VALUES ('sample-1', 'sample-session', 'Sample bank', 'EUR')");
  assert.deepEqual(api.bankAccess().map((a) => a.bank), ['Test bank']);
  db.exec("DELETE FROM accounts WHERE uid = 'sample-1'");
  db.exec("DELETE FROM sessions WHERE id = 'sample-session'");
});

const project = '/Users/someone/R&D <budget>';
const cmd = command(project, '/usr/local/bin/node');

test('the scheduler runs this Node on scheduled.js, with the project’s .env', () => {
  assert.deepEqual(cmd, ['/usr/local/bin/node', `--env-file-if-exists=${join(project, '.env')}`, '--disable-warning=ExperimentalWarning', join(project, 'src', 'scheduled.js')]);
});

test('launchd: every day at 07:30, the path escaped', () => {
  const plist = launchdPlist(cmd, project);
  assert.match(plist, /<key>Hour<\/key><integer>7<\/integer><key>Minute<\/key><integer>30<\/integer>/);
  assert.ok(plist.includes('R&amp;D &lt;budget&gt;') && !plist.includes('R&D <budget>'));
  if (process.platform === 'darwin') {
    const file = join(mkdtempSync(join(tmpdir(), 'munto-plist-')), 'test.plist');
    writeFileSync(file, plist);
    execFileSync('plutil', ['-lint', file], { stdio: 'pipe' }); // throws when it isn't a valid plist
  }
});

test('systemd: a timer that catches up after sleep, every argument quoted', () => {
  const { service, timer } = systemdUnits(['/bin/node', '50%"off"'], '/home/someone/munto');
  assert.match(service, /^ExecStart="\/bin\/node" "50%%\\"off\\""$/m);
  assert.match(timer, /^OnCalendar=\*-\*-\* 07:30:00$/m);
  assert.match(timer, /^Persistent=true$/m);
});

test('Task Scheduler: the paths go in as environment variables, not in the script', () => {
  const task = windowsTask(['C:\\Program Files\\nodejs\\node.exe', '--x', 'C:\\Users\\someone\\munto\\src\\scheduled.js'], 'C:\\Users\\someone\\munto');
  assert.ok(!task.script.includes('someone'));
  assert.match(task.script, /-StartWhenAvailable/);
  assert.equal(task.env.MUNTO_NODE, 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(task.env.MUNTO_ARGS, '"--x" "C:\\Users\\someone\\munto\\src\\scheduled.js"');
});

test('notifications: the text is an argument, never part of the script', () => {
  const title = 'Bank "A" ends"; do shell script "x';
  const [file, args] = notifyCommand(title, 'Renew it', 'darwin');
  assert.equal(file, 'osascript');
  assert.deepEqual(args.slice(-2), [title, 'Renew it']);
  assert.ok(args.slice(0, -2).every((a) => a === '-e' || !a.includes('Bank')));
  const [, winArgs, env] = notifyCommand(title, 'Renew it', 'win32');
  assert.ok(!winArgs.join(' ').includes('Bank'));
  assert.equal(env.MUNTO_TITLE, title);
  assert.equal(notifyCommand('a', 'b', 'aix'), null);
});

test('notifications: text starting with a dash can’t be read as an option', () => {
  const [, mac] = notifyCommand('-e do shell script "x"', '-s', 'darwin');
  assert.deepEqual(mac.slice(-2), ['‐e do shell script "x"', '‐s']);
  assert.ok(mac.slice(0, -2).every((a, i) => (i % 2 === 0 ? a === '-e' : !a.startsWith('-'))), 'only our own -e options');
  const [, linux] = notifyCommand('-x', 'body', 'linux');
  assert.deepEqual(linux, ['--app-name=Munto', '--', '‐x', 'body']);
});

// The scheduled run itself, without a bank to call: the paths that don't sync.
const scheduled = () => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/scheduled.js'], { env: process.env });
const log = () => readFileSync(join(dir, 'sync.log'), 'utf8');

test('the scheduled run skips when a sync just ran (the desktop app’s, say)', () => {
  db.exec("UPDATE sessions SET valid_until = '2099-01-01'");
  db.prepare("UPDATE accounts SET last_synced = ? WHERE uid = 'a1'").run(new Date().toISOString());
  scheduled();
  assert.match(log(), /Already synced at .*: skipped\./);
});

test('the scheduled run has nothing to do before a bank is linked', () => {
  db.exec('DELETE FROM accounts');
  scheduled();
  assert.match(log(), /No bank linked yet: nothing to sync\./);
});
