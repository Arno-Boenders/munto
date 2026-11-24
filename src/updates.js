// Is there a newer version on GitHub? For a copy installed from source (git): fetch, and compare. Your own
// changes are never overwritten: with uncommitted changes, or a branch that isn't simply behind, it says so.
// The desktop app's Update button (electron/updates.js) then hands over to scripts/update.mjs.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Git with the tricks a repository's own config could play switched off, and errors without credentials.
export const GIT_SAFE = ['-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];
export const scrub = (text) => String(text).replace(/\/\/[^@\s/]+@/g, '//').replace(/(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '[token]');
const git = (root, args) => new Promise((resolve, reject) => execFile('git', [...GIT_SAFE, ...args], {
  cwd: root, encoding: 'utf8', timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
}, (err, out, stderr) => (err ? reject(new Error(scrub(String(stderr || err.message).trim().split('\n').at(-1)))) : resolve(out.trim()))));
// Updates only come from GitHub over https.
export const allowedRemote = (url) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(scrub(url));

export async function checkForUpdate(root) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  if (!existsSync(join(root, '.git'))) return { version, canUpdate: false, reason: 'This copy wasn’t installed with git, so it can’t update itself: download the newest version from the Releases page on GitHub.' };
  const local = await git(root, ['rev-parse', '--short', 'HEAD']);
  const base = { version, local };
  try { await git(root, ['fetch', '--quiet']); } catch { return { ...base, canUpdate: false, reason: 'Couldn’t reach GitHub. Check your internet connection and try again.' }; }
  let upstream;
  try { upstream = await git(root, ['rev-parse', '--abbrev-ref', '@{u}']); } catch { return { ...base, canUpdate: false, reason: 'This branch doesn’t follow one on GitHub.' }; }
  const remote = upstream.split('/')[0];
  const url = await git(root, ['remote', 'get-url', remote]).catch(() => '');
  if (!allowedRemote(url)) return { ...base, canUpdate: false, reason: 'Updates only come from a GitHub repository over https; this copy follows something else.' };
  const behind = Number(await git(root, ['rev-list', '--count', 'HEAD..@{u}']));
  const ahead = Number(await git(root, ['rev-list', '--count', '@{u}..HEAD']));
  const dirty = (await git(root, ['status', '--porcelain', '--untracked-files=no'])) !== '';
  // What changed, by title: merge commits only say which branch came in, so they're left out.
  const changes = behind ? (await git(root, ['log', '--no-merges', '--format=%s', '-n', '12', 'HEAD..@{u}'])).split('\n').filter(Boolean) : [];
  const changeCount = behind ? Number(await git(root, ['rev-list', '--count', '--no-merges', 'HEAD..@{u}'])) : 0;
  const reason = !behind ? null
    : dirty ? 'You changed the code here: commit or stash that first, or update with git pull yourself.'
    : ahead ? `This copy has ${ahead} commit${ahead === 1 ? '' : 's'} of its own: update with git pull yourself.` : null;
  return { ...base, upstream, behind, changes, changeCount, canUpdate: behind > 0 && !reason, reason, checkedAt: new Date().toISOString() };
}

