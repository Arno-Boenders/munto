// npm run app:install: builds the desktop app from this project and installs it for you.
//   1. builds the UI into .next-app/ (the app runs it from here)
//   2. writes this folder's path into the launcher, and packages the launcher with electron-builder
//   3. installs it: macOS /Applications/Munto.app (signed for this Mac only), Windows your own
//      programs folder with a Start menu shortcut, Linux ~/.local/opt/Munto with a menu entry
// Built on this computer, so neither macOS nor Windows warns about an unknown developer. Your data is backed
// up first. Run it again after pulling changes (or use Update in the app).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (file, args, env = {}) => execFileSync(file, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
const node = (args, env) => run(process.execPath, args, env);
const quietly = (file, args) => { try { execFileSync(file, args, { stdio: 'ignore' }); } catch { /* not running, or not there */ } };
const PLATFORM = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
if (!PLATFORM) { console.error(`app:install doesn't support ${process.platform} yet. Use npm run app.`); process.exit(1); }
// Build for the computer's own chip, not for whatever runs this script. Update in the app runs it with the
// app's Electron: an Intel copy on an Apple Silicon Mac runs translated by Rosetta (slow), and would
// otherwise keep rebuilding itself for Intel.
const appleSilicon = () => { try { return execFileSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1'; } catch { return false; } };
const ARCH = process.platform === 'darwin' && process.arch === 'x64' && appleSilicon() ? 'arm64' : process.arch;

console.log('1/3 Building the app…');
node([join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], { NEXT_DIST_DIR: '.next-app', NODE_OPTIONS: '--disable-warning=ExperimentalWarning' });

console.log('2/3 Packaging Munto…');
// Electron fetches its program the first time it's used, not during npm install: on a fresh checkout
// node_modules/electron/dist is still empty, and electron-builder packages what's in there.
await import('electron');
writeFileSync(join(root, 'electron', 'launcher', 'source.json'), JSON.stringify({ source: root }, null, 2) + '\n');
node([join(root, 'node_modules', 'electron-builder', 'cli.js'), `--${PLATFORM}`, 'dir', `--${ARCH}`, '--publish', 'never']);

console.log('3/3 Installing…');
const { backup } = await import('../src/backup.js');
const saved = backup('update'); // a copy of your data before the new version first opens it
if (saved) console.log(`    your data is backed up in ${saved}`);
const out = (name) => join(root, 'dist', name);
const arch = ARCH === 'x64' ? '' : `-${ARCH}`;

if (PLATFORM === 'mac') {
  const built = join(out(ARCH === 'arm64' ? 'mac-arm64' : 'mac'), 'Munto.app');
  if (!existsSync(built)) throw new Error(`Expected ${built}`);
  const target = '/Applications/Munto.app';
  quietly('osascript', ['-e', 'tell application "Munto" to quit']);
  rmSync(target, { recursive: true, force: true });
  // The app used to be called Envelopes: that one goes (your data is copied over when Munto first opens).
  quietly('osascript', ['-e', 'tell application "Envelopes" to quit']);
  rmSync('/Applications/Envelopes.app', { recursive: true, force: true });
  cpSync(built, target, { recursive: true, verbatimSymlinks: true });
  // Sign it for this Mac only ("ad hoc", no Apple account needed). Renaming Electron's bundle broke its
  // original signature; macOS features like notifications and opening at login want a valid one.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', target], { stdio: 'inherit' });
  console.log(`Done: ${target}. Open it from Applications or Spotlight.`);
} else if (PLATFORM === 'win') {
  const built = out(`win${arch}-unpacked`);
  if (!existsSync(built)) throw new Error(`Expected ${built}`);
  const target = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Munto');
  quietly('taskkill', ['/IM', 'Munto.exe', '/F']);
  rmSync(target, { recursive: true, force: true });
  quietly('taskkill', ['/IM', 'Envelopes.exe', '/F']); // what the app used to be called
  rmSync(join(dirname(target), 'Envelopes'), { recursive: true, force: true });
  cpSync(built, target, { recursive: true });
  // A Start menu shortcut, so it opens like any other app.
  const exe = join(target, 'Munto.exe');
  const menu = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  rmSync(join(menu, 'Envelopes.lnk'), { force: true });
  const ps = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${join(menu, 'Munto.lnk').replace(/'/g, "''")}'); `
    + `$s.TargetPath = '${exe.replace(/'/g, "''")}'; $s.WorkingDirectory = '${target.replace(/'/g, "''")}'; $s.Save()`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
  console.log(`Done: ${exe}. Open it from the Start menu.`);
} else {
  const built = out(`linux${arch}-unpacked`);
  if (!existsSync(built)) throw new Error(`Expected ${built}`);
  const target = join(homedir(), '.local', 'opt', 'Munto');
  quietly('pkill', ['-x', 'munto']);
  rmSync(target, { recursive: true, force: true });
  quietly('pkill', ['-x', 'envelopes']); // what the app used to be called
  rmSync(join(dirname(target), 'Envelopes'), { recursive: true, force: true });
  cpSync(built, target, { recursive: true, verbatimSymlinks: true });
  const apps = join(homedir(), '.local', 'share', 'applications');
  mkdirSync(apps, { recursive: true });
  rmSync(join(apps, 'envelopes.desktop'), { force: true });
  writeFileSync(join(apps, 'munto.desktop'), [
    '[Desktop Entry]', 'Type=Application', 'Name=Munto', 'Comment=Local-first budgeting',
    `Exec="${join(target, 'munto')}"`, `Icon=${join(root, 'build', 'icon.png')}`, 'Categories=Office;Finance;', '',
  ].join('\n'));
  console.log(`Done: ${target}. Open it from your app menu.`);
}
