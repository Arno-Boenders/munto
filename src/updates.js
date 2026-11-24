// Is there a newer version on GitHub? For a copy installed from source (git): fetch, and compare. Your own
// changes are never overwritten: with uncommitted changes, or a branch that isn't simply behind, it says so.
// For a downloaded copy: the latest release, with a link to download it (see latestRelease).
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

// A downloaded copy (no git) can't update itself: it asks GitHub's Releases page for the latest version, and if
// that's newer, says so with a link to download it. Nothing is sent but the request itself.
const DEFAULT_REPO = 'Arno-Boenders/munto';
export const repoOf = (pkg) => {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return String(url ?? '').match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(\.git)?\/?$/)?.[1] ?? DEFAULT_REPO;
};
// 1 when a is newer than b, -1 when older, 0 when the same ("v" and anything after "-" ignored).
export function compareVersions(a, b) {
  const parts = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  return 0;
}
// The release notes as short plain lines: list items and sentences, without Markdown or links.
export const noteLines = (body) => String(body ?? '').split(/\r?\n/)
  .map((l) => l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/[#*_`>]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim())
  .filter((l) => l && !/^(full changelog|what's changed)/i.test(l)).slice(0, 8).map((l) => l.slice(0, 200));

async function latestRelease(repo, version, fetchFn) {
  let res;
  try {
    res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Munto' }, signal: AbortSignal.timeout(15_000),
    });
  } catch { return { version, canUpdate: false, reason: 'Couldn’t reach GitHub. Check your internet connection and try again.' }; }
  if (res.status === 404) return { version, canUpdate: false, reason: null }; // no release published yet
  if (!res.ok) return { version, canUpdate: false, reason: 'GitHub didn’t answer the update check. Try again later.' };
  const release = await res.json().catch(() => ({}));
  const latest = String(release.tag_name ?? '').replace(/^v/i, '');
  // Only ever this project's own release page: the Download button opens it.
  const page = String(release.html_url ?? '');
  const url = page.startsWith(`https://github.com/${repo}/releases/`) ? page : `https://github.com/${repo}/releases/latest`;
  const checkedAt = new Date().toISOString();
  if (!latest || compareVersions(latest, version) <= 0) return { version, canUpdate: false, reason: null, checkedAt };
  return { version, canUpdate: false, reason: null, checkedAt, download: { version: latest, url, changes: noteLines(release.body) } };
}

export async function checkForUpdate(root, { fetchFn = fetch } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const { version } = pkg;
  if (!existsSync(join(root, '.git'))) return latestRelease(repoOf(pkg), version, fetchFn);
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

