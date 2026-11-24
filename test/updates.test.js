// Updates come only from GitHub over https, and errors never show credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedRemote, scrub } from '../src/updates.js';

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
