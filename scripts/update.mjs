// Updates Munto from GitHub, started by the app's Update button (electron/updates.js) after the app has
// quit: back up your data, pull, install new dependencies if they changed, rebuild, and open the app again.
// If any step fails, it goes back to the version you had (git reset to the old commit) and rebuilds that, so
// the app always opens again; the result is in update-result.json in your data folder, which the app shows.
//   node scripts/update.mjs --wait <pid> [--reopen /Applications/Munto.app]
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const { dbPath, privateFile } = await import('../src/paths.js');
const { GIT_SAFE, allowedRemote, checkForUpdate, scrub } = await import('../src/updates.js');
const folder = dirname(dbPath());
const logFile = join(folder, 'update.log');
const log = (line) => { appendFileSync(logFile, `[${new Date().toISOString()}] ${scrub(line)}\n`, { mode: 0o600 }); privateFile(logFile); };
const run = (cmd, args, env = {}) => {
  if (cmd === 'git') args = [...GIT_SAFE, ...args];
  log(`$ ${cmd} ${args.join(' ')}`);
  // On Windows npm is npm.cmd, which only runs through the shell (its arguments here are plain words).
  const viaShell = process.platform === 'win32' && cmd === 'npm';
  const out = execFileSync(viaShell ? 'npm.cmd' : cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000, shell: viaShell, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } });
  if (out.trim()) log(out.trim().split('\n').slice(-20).join('\n'));
  return out.trim();
};
const node = process.execPath; // in the app this is Electron, run as plain Node (ELECTRON_RUN_AS_NODE)
const build = () => run(node, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], { NEXT_DIST_DIR: '.next-app', NODE_OPTIONS: '--disable-warning=ExperimentalWarning' });
const pkg = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Wait for the app to have quit, so nothing reads the build while it's replaced.
const pid = Number(arg('--wait'));
for (let i = 0; pid && i < 120; i++) {
  try { process.kill(pid, 0); } catch { break; }
  await new Promise((r) => setTimeout(r, 250));
}

// One update at a time.
const lockFile = join(folder, 'update.lock');
let lock;
try { lock = openSync(lockFile, 'wx'); } catch { log('Another update is already running.'); process.exit(0); }

const result = { ok: false, at: new Date().toISOString(), from: null, to: null, error: null };
let from;
try {
  // Check again right here: from GitHub over https, nothing of your own that a pull or a reset could touch.
  const info = await checkForUpdate(root);
  if (!info.canUpdate) throw new Error(info.reason ?? 'There’s nothing to update.');
  const remote = run('git', ['rev-parse', '--abbrev-ref', '@{u}']).split('/')[0];
  if (!allowedRemote(run('git', ['remote', 'get-url', remote]))) throw new Error('Updates only come from GitHub over https.');
  from = run('git', ['rev-parse', 'HEAD']);
  result.from = from.slice(0, 7);
  const { backup } = await import('../src/backup.js');
  const saved = backup('update');
  if (saved) log(`Data backed up in ${saved}`);
  const electronBefore = pkg().devDependencies?.electron;
  run('git', ['pull', '--ff-only']);
  const to = run('git', ['rev-parse', 'HEAD']);
  result.to = to.slice(0, 7);
  const changed = run('git', ['diff', '--name-only', from, to]).split('\n');
  if (changed.includes('package-lock.json') || changed.includes('package.json')) run('npm', ['ci', '--no-audit', '--no-fund']);
  if (arg('--reopen') && pkg().devDependencies?.electron !== electronBefore) {
    run(node, [join(root, 'scripts', 'app-install.mjs')]); // a new Electron: the app itself is rebuilt too
  } else {
    build();
  }
  result.ok = true;
  log(`Updated ${result.from} → ${result.to}`);
} catch (err) {
  // The line that says what went wrong, not the last line of a stack trace.
  const lines = scrub(`${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message}`).split('\n').map((l) => l.trim()).filter(Boolean);
  result.error = (lines.find((l) => /error|failed|fatal|conflict|not possible|only come|nothing to update|changed the code/i.test(l) && !/^at /.test(l)) ?? lines.at(-1) ?? 'unknown').slice(0, 400);
  log(`Update failed: ${result.error}`);
  // Back to the version you had, and rebuild it, so the app opens as before.
  // (Only when it got past the old commit: if pulling itself failed, nothing changed.)
  if (from && run('git', ['rev-parse', 'HEAD']) !== from) {
    try {
      run('git', ['reset', '--hard', from]);
      run('npm', ['ci', '--no-audit', '--no-fund']);
      build();
      log(`Back on ${from.slice(0, 7)}`);
    } catch (err2) {
      log(`Going back failed too: ${err2.message}. Run npm ci and npm run app:install in ${root}.`);
      result.error += ' (going back failed too: see update.log)';
    }
  }
}
writeFileSync(join(folder, 'update-result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
closeSync(lock);
rmSync(lockFile, { force: true });

const reopen = arg('--reopen');
if (reopen) {
  try {
    if (process.platform === 'darwin') execFileSync('open', [reopen]);
    else {
      // Without ELECTRON_RUN_AS_NODE (this script runs with it), or the app would start as plain Node.
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      spawn(reopen, [], { detached: true, stdio: 'ignore', env }).unref();
    }
  } catch (err) { log(`Couldn’t reopen ${reopen}: ${err.message}`); }
}
