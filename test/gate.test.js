// The check in front of every route (proxy.js and the dev server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuse } from '../lib/gate.js';

const req = (headers, { method = 'GET', path = '/', token } = {}) => ({
  method, path, token, headers: new Headers({ host: 'localhost:4000', ...headers }),
});
const status = (r) => refuse(r)?.status ?? 'ok';

test('only requests addressed to this machine are answered', () => {
  assert.equal(status(req({})), 'ok');
  assert.equal(status(req({ host: '127.0.0.1:4000' })), 'ok');
  assert.equal(status(req({ host: '[::1]:4000' })), 'ok');
  assert.equal(status(req({ host: 'evil.example:4000' })), 403);
  assert.equal(status(req({ host: 'localhost.evil.example' })), 403);
});

test('nothing a browser marks as from another website', () => {
  assert.equal(status(req({ 'sec-fetch-site': 'cross-site' })), 403);
  assert.equal(status(req({ 'sec-fetch-site': 'same-origin' })), 'ok');
});

test('the desktop app’s secret is required when it is set', () => {
  const token = 'a'.repeat(64);
  assert.equal(status(req({}, { token })), 403);
  assert.equal(status(req({ 'x-munto-token': 'b'.repeat(64) }, { token })), 403);
  assert.equal(status(req({ 'x-munto-token': 'a' }, { token })), 403);
  assert.equal(status(req({ 'x-munto-token': token }, { token })), 'ok');
});

test('changes only come as JSON from our own origin', () => {
  const post = { method: 'POST', path: '/api/rules' };
  const json = { 'content-type': 'application/json' };
  assert.equal(status(req({ ...json, origin: 'http://localhost:4000' }, post)), 'ok');
  assert.equal(status(req(json, post)), 'ok'); // no Origin: not a browser on another site
  assert.equal(status(req({ ...json, origin: 'http://localhost:5173' }, post)), 403); // another local app
  assert.equal(status(req({ ...json, origin: 'null' }, post)), 403);
  assert.equal(status(req({ ...json, origin: 'https://evil.example' }, post)), 403);
  assert.equal(status(req({ origin: 'http://localhost:4000', 'content-type': 'text/plain' }, post)), 415);
});
