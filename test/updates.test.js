// Updates come only from GitHub over https, and errors never show credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedRemote, checkForUpdate, compareVersions, noteLines, repoOf, scrub } from '../src/updates.js';

// A downloaded copy: a folder with a package.json and no git. The fake fetch stands in for GitHub.
const copy = (version, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'munto-copy-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'munto', version, ...extra }));
  return dir;
};
const github = (body, status = 200) => async (url, init) => {
  github.asked = { url: String(url), headers: init.headers };
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};

test('versions: newer, older, the same', () => {
  assert.equal(compareVersions('0.4.1', '0.4.0'), 1);
  assert.equal(compareVersions('v0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
  assert.equal(compareVersions('0.4', '0.4.0'), 0);
  assert.equal(compareVersions('0.3.9', '0.4.0'), -1);
});

test('a downloaded copy hears about a newer release, with a link to this project’s release page', async () => {
  const release = { tag_name: 'v0.5.0', html_url: 'https://github.com/Arno-Boenders/munto/releases/tag/v0.5.0', body: "## What's changed\n- **Dutch** interface\n- Fixes\n\n**Full Changelog**: x" };
  const info = await checkForUpdate(copy('0.4.0'), { fetchFn: github(release) });
  assert.equal(info.canUpdate, false);
  assert.deepEqual(info.download, { version: '0.5.0', url: release.html_url, changes: ['Dutch interface', 'Fixes'] });
  assert.equal(github.asked.url, 'https://api.github.com/repos/Arno-Boenders/munto/releases/latest');
  assert.ok(!JSON.stringify(github.asked.headers).includes('0.4.0'), 'nothing but the request is sent');
});

test('no notice for the same or an older release, or none at all', async () => {
  assert.equal((await checkForUpdate(copy('0.4.0'), { fetchFn: github({ tag_name: 'v0.4.0' }) })).download, undefined);
  assert.equal((await checkForUpdate(copy('0.5.0'), { fetchFn: github({ tag_name: 'v0.4.0' }) })).download, undefined);
  assert.equal((await checkForUpdate(copy('0.4.0'), { fetchFn: github({}, 404) })).reason, null);
});

test('a link to anywhere else is replaced by the release page, and a failed check says so', async () => {
  const info = await checkForUpdate(copy('0.4.0'), { fetchFn: github({ tag_name: 'v9.0.0', html_url: 'https://evil.example/munto.dmg' }) });
  assert.equal(info.download.url, 'https://github.com/Arno-Boenders/munto/releases/latest');
  assert.match((await checkForUpdate(copy('0.4.0'), { fetchFn: async () => { throw new Error('offline'); } })).reason, /reach GitHub/);
  assert.match((await checkForUpdate(copy('0.4.0'), { fetchFn: github({}, 500) })).reason, /didn’t answer/);
});

test('a fork checks its own releases, and release notes become plain lines', () => {
  assert.equal(repoOf({ repository: { url: 'https://github.com/someone/fork.git' } }), 'someone/fork');
  assert.equal(repoOf({ repository: 'git+https://github.com/someone/fork' }), 'someone/fork');
  assert.equal(repoOf({}), 'Arno-Boenders/munto');
  assert.deepEqual(noteLines('1. [Link](https://x.example) text\n> quote\n\n- `code`'), ['Link text', 'quote', 'code']);
});

test('only a GitHub repository over https', () => {
  assert.ok(allowedRemote('https://github.com/Arno-Boenders/envelopes.git'));
  assert.ok(allowedRemote('https://github.com/someone/fork'));
  for (const bad of ['git@github.com:a/b.git', 'http://github.com/a/b', 'https://evil.example/a/b', 'ext::sh -c touch% /tmp/x', 'file:///tmp/repo', 'https://github.com.evil.example/a/b']) {
    assert.ok(!allowedRemote(bad), bad);
  }
});

test('credentials are scrubbed from git output', () => {
  assert.equal(scrub('fatal: unable to access https://user:secret@github.com/a/b'), 'fatal: unable to access https://github.com/a/b');
  assert.equal(scrub('token ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'token [token]');
});
