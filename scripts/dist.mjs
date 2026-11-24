// npm run dist: builds Munto as a download for people without Node, git or a terminal, into dist/:
//   macOS   Munto-<version>-arm64.dmg and Munto-<version>-x64.dmg (unsigned: see README, Downloads)
//   Windows Munto-Setup-<version>.exe (installs for you only, no admin rights needed)
//   Linux   Munto-<version>-<arch>.AppImage and munto_<version>_<arch>.deb
// Unlike npm run app:install, the app itself is inside: the built pages, the code the server and sync run,
// and their dependencies. Your data never is: it lives in the app's data folder (src/paths.js).
// Builds for the computer it runs on; CI runs it on each platform (.github/workflows/release.yml).
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const node = (args, env = {}) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

console.log('1/2 Building the app…');
rmSync(join(root, '.next-app'), { recursive: true, force: true }); // only this build's files go in
node([join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], { NEXT_DIST_DIR: '.next-app', NODE_OPTIONS: '--disable-warning=ExperimentalWarning' });

console.log('2/2 Packaging…');
const { build } = await import('electron-builder');
// Not the launcher setup app:install uses, nor its electronDist: that's the Electron in node_modules, for
// this computer's processor only. Here electron-builder fetches the right one for each (electronVersion).
const { directories, files, electronDist, ...shared } = pkg.build;
const config = {
  ...shared,
  electronDist: null, // (package.json's build settings are merged in too, so this has to say so)
  directories: { app: '.', output: 'dist', buildResources: 'build' },
  // The app's own files; electron-builder adds the production dependencies (Next.js, React, the
  // Anthropic SDK). Not in it: the launcher, scripts, tests, docs, .env, secrets/ and data/.
  files: [
    'package.json', 'next.config.mjs',
    'electron/*.js', '!electron/make-icon.js',
    'src/**', 'lib/**', 'config/categories.example.json',
    '.next-app/**', '!.next-app/cache{,/**}', '!.next-app/dev{,/**}', '!.next-app/diagnostics{,/**}', '!.next-app/trace*',
    'build/icon.png', 'build/trayTemplate.png', 'build/trayTemplate@2x.png',
    // electron-builder picks the production dependencies; this list filters those too, so say they're in.
    'node_modules/**',
    // The compiler Next.js uses while building; the finished app never compiles anything.
    '!node_modules/@next/swc-*{,/**}',
    // Image resizing (the app has no next/image) and Next.js's own docs.
    '!node_modules/sharp{,/**}', '!node_modules/@img{,/**}', '!node_modules/next/dist/docs{,/**}',
  ],
  artifactName: '${productName}-${version}-${arch}.${ext}',
  mac: {
    ...shared.mac,
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    // Signed "ad hoc": enough for Apple Silicon to start it at all. Without an Apple Developer ID, macOS
    // still asks once to allow it (System Settings, Privacy & Security, Open Anyway).
    identity: '-', hardenedRuntime: false,
  },
  dmg: { artifactName: '${productName}-${version}-${arch}.${ext}' },
  win: { ...shared.win, target: ['nsis'] },
  nsis: { oneClick: true, perMachine: false, artifactName: '${productName}-Setup-${version}.${ext}', shortcutName: 'Munto' },
  linux: { ...shared.linux, target: ['AppImage', 'deb'], maintainer: 'Munto', synopsis: 'Local-first budgeting' },
  deb: { artifactName: '${name}_${version}_${arch}.${ext}' },
};
const made = await build({ config, publish: 'never' });
console.log(`\nDone:\n${made.filter((f) => !f.endsWith('.blockmap')).map((f) => `  ${f}`).join('\n')}`);
