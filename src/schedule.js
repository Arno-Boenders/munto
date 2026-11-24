// npm run schedule: a daily sync at 07:30 for Munto in the browser (npm run ui), run by your computer's own
// scheduler: launchd on macOS, a systemd user timer on Linux, Task Scheduler on Windows. A computer that's
// asleep then syncs when it wakes up. The desktop app doesn't need this: it syncs every morning by itself.
//   npm run schedule               set it up (or again, after moving the project or changing Node)
//   npm run schedule -- --off      remove it
//   npm run schedule -- --status   is it set up?
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT } from './paths.js';

export const HOUR = 7;
export const MINUTE = 30;
export const LABEL = 'app.munto.sync'; // launchd
export const UNIT = 'munto-sync'; // systemd
export const TASK = 'Munto sync'; // Task Scheduler

// What the scheduler runs: this Node, with the project's .env (when there is one), on scheduled.js.
export function command(project = PROJECT, node = process.execPath) {
  return [node, `--env-file-if-exists=${join(project, '.env')}`, '--disable-warning=ExperimentalWarning', join(project, 'src', 'scheduled.js')];
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function launchdPlist(cmd, project = PROJECT) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${cmd.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(project)}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${HOUR}</integer><key>Minute</key><integer>${MINUTE}</integer></dict>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

// systemd quotes each argument; a % is a specifier unless doubled.
const unitArg = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
export function systemdUnits(cmd, project = PROJECT) {
  return {
    service: `[Unit]\nDescription=Munto: the daily sync\n\n[Service]\nType=oneshot\nWorkingDirectory=${unitArg(project)}\nExecStart=${cmd.map(unitArg).join(' ')}\n`,
    // Persistent: a run missed while the computer was off or asleep happens when it's back.
    timer: `[Unit]\nDescription=Munto: the daily sync at ${HOUR}:${MINUTE}\n\n[Timer]\nOnCalendar=*-*-* ${String(HOUR).padStart(2, '0')}:${MINUTE}:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`,
  };
}

// Task Scheduler through PowerShell (schtasks can't start a missed run later, and limits the command to
// 261 characters). The values go in as environment variables, never pasted into the script.
const PS_SET = [
  '$a = New-ScheduledTaskAction -Execute $env:MUNTO_NODE -Argument $env:MUNTO_ARGS -WorkingDirectory $env:MUNTO_DIR',
  `$t = New-ScheduledTaskTrigger -Daily -At '${String(HOUR).padStart(2, '0')}:${MINUTE}'`,
  '$s = New-ScheduledTaskSettingsSet -StartWhenAvailable',
  `Register-ScheduledTask -TaskName '${TASK}' -Action $a -Trigger $t -Settings $s -Force | Out-Null`,
].join('; ');
const winArg = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
export function windowsTask(cmd, project = PROJECT) {
  return { script: PS_SET, env: { MUNTO_NODE: cmd[0], MUNTO_ARGS: cmd.slice(1).map(winArg).join(' '), MUNTO_DIR: project } };
}

const run = (file, args, opts = {}) => execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
const ok = (file, args, opts) => { try { run(file, args, opts); return true; } catch { return false; } };
const powershell = (script, env = {}) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, ...env } });

const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const unitDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user');
const gui = () => `gui/${userInfo().uid}`;

export function status(platform = process.platform) {
  if (platform === 'darwin') return ok('launchctl', ['print', `${gui()}/${LABEL}`]);
  if (platform === 'linux') return ok('systemctl', ['--user', 'is-enabled', '--quiet', `${UNIT}.timer`]);
  if (platform === 'win32') return ok('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-ScheduledTask -TaskName '${TASK}' -ErrorAction Stop | Out-Null`]);
  return false;
}

export function install(platform = process.platform) {
  const cmd = command();
  if (platform === 'darwin') {
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    ok('launchctl', ['bootout', `${gui()}/${LABEL}`]); // an older one, if there is one
    writeFileSync(plistPath(), launchdPlist(cmd));
    run('launchctl', ['bootstrap', gui(), plistPath()]);
  } else if (platform === 'linux') {
    const units = systemdUnits(cmd);
    mkdirSync(unitDir(), { recursive: true });
    writeFileSync(join(unitDir(), `${UNIT}.service`), units.service);
    writeFileSync(join(unitDir(), `${UNIT}.timer`), units.timer);
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', `${UNIT}.timer`]);
  } else if (platform === 'win32') {
    const task = windowsTask(cmd);
    powershell(task.script, task.env);
  } else {
    throw new Error(`Scheduling isn't supported on ${platform} yet: run npm run sync from your own scheduler.`);
  }
}

export function uninstall(platform = process.platform) {
  if (platform === 'darwin') {
    ok('launchctl', ['bootout', `${gui()}/${LABEL}`]);
    rmSync(plistPath(), { force: true });
  } else if (platform === 'linux') {
    ok('systemctl', ['--user', 'disable', '--now', `${UNIT}.timer`]);
    rmSync(join(unitDir(), `${UNIT}.service`), { force: true });
    rmSync(join(unitDir(), `${UNIT}.timer`), { force: true });
    ok('systemctl', ['--user', 'daemon-reload']);
  } else if (platform === 'win32') {
    ok('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Unregister-ScheduledTask -TaskName '${TASK}' -Confirm:$false`]);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const at = `${String(HOUR).padStart(2, '0')}:${MINUTE}`;
  try {
    if (arg === '--status') {
      console.log(status() ? `The daily sync is set up: every day at ${at}.` : 'No daily sync set up. Run: npm run schedule');
    } else if (arg === '--off') {
      uninstall();
      console.log('The daily sync is removed.');
    } else {
      install();
      console.log(`The daily sync is set up: every day at ${at}, or when the computer wakes up after that.`);
      console.log('It backs up your data first, and notifies you of new transactions and of bank access that ends within a week.');
      console.log('What it did: sync.log in your data folder. Remove it with: npm run schedule -- --off');
      if (process.platform === 'darwin' && existsSync('/Applications/Munto.app')) {
        console.log('(The desktop app syncs every morning by itself too: when it already did, this one skips.)');
      }
    }
  } catch (err) {
    console.error(`That didn't work: ${String(err.stderr || err.message).trim()}`);
    process.exitCode = 1;
  }
}
