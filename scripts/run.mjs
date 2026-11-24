// The npm commands that start Next.js, Electron or the tests, written in Node instead of shell syntax so
// they work the same on macOS, Linux and Windows (PowerShell, cmd).
//   node scripts/run.mjs ui | build | start | app | test
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (pkg, file) => join(root, 'node_modules', pkg, ...file.split('/'));
const NEXT = bin('next', 'dist/bin/next');
const quiet = { NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') };
const port = process.env.PORT || '4000';

function run(file, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', (code, signal) => resolve(signal ? 1 : code ?? 0));
  });
}
const node = (args, env) => run(process.execPath, args, env);

// macOS names an app in the menu bar and Dock after its bundle, so Electron from source says "Electron".
// A copy of Electron.app renamed Munto (and signed again, since its Info.plist changed) fixes that; it is
// made again whenever Electron is updated.
function macApp(electron) {
  const source = join(dirname(electron), '..', '..');
  const app = join(root, 'node_modules', '.munto-dev', 'Munto.app');
  const stamp = join(root, 'node_modules', '.munto-dev', 'version');
  const version = readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8').match(/"version": "([^"]+)"/)[1];
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== version) {
    rmSync(dirname(app), { recursive: true, force: true });
    mkdirSync(dirname(app), { recursive: true });
    execFileSync('cp', ['-Rc', source, app]);
    const plist = join(app, 'Contents', 'Info.plist');
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) execFileSync('plutil', ['-replace', key, '-string', 'Munto', plist]);
    execFileSync('plutil', ['-replace', 'CFBundleIdentifier', '-string', 'app.munto.dev', plist]);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
    writeFileSync(stamp, version);
  }
  return join(app, 'Contents', 'MacOS', 'Electron');
}

const commands = {
  // Not `next dev`: its dev endpoints run before proxy.js (see scripts/dev-server.mjs).
  ui: () => node([join(root, 'scripts', 'dev-server.mjs')], { ...quiet, PORT: port, NODE_ENV: 'development' }),
  build: () => node([NEXT, 'build'], quiet),
  start: () => node([NEXT, 'start', '-H', '127.0.0.1', '-p', port], quiet),
  // The desktop app from source: build into its own folder, then start Electron.
  app: async () => {
    const built = await node([NEXT, 'build'], { ...quiet, NEXT_DIST_DIR: '.next-app' });
    if (built !== 0) return built;
    const { default: electron } = await import('electron'); // the path to the Electron binary
    return run(process.platform === 'darwin' ? macApp(electron) : electron, ['.']);
  },
  // Every test file, each in its own process (node --test does that).
  test: () => node(['--disable-warning=ExperimentalWarning', '--test', ...readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.js')).sort().map((f) => join('test', f))]),
};

const name = process.argv[2];
if (!commands[name]) {
  console.error(`Usage: node scripts/run.mjs ${Object.keys(commands).join(' | ')}`);
  process.exit(1);
}
process.exit(await commands[name]());
