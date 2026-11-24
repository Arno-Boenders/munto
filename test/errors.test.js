// Errors say what to do next, never just a status code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorText } from '../lib/errors.js';

test('the server’s own words come through', () => {
  assert.equal(errorText(400, 'Pick a category'), 'Pick a category');
});

test('a crash, a missing route, the proxy and no answer each get a sentence', () => {
  assert.match(errorText(500, null), /Try again/);
  assert.match(errorText(502), /Try again/);
  assert.match(errorText(404), /Reload the page/);
  assert.match(errorText(404, 'No route for POST /api/nope'), /Reload the page/);
  assert.equal(errorText(404, 'No such payment'), 'No such payment');
  assert.match(errorText(403, 'Forbidden origin'), /Reload the page/);
  assert.match(errorText(415, 'Expected JSON'), /Reload the page/);
  assert.match(errorText('offline'), /isn’t answering/);
  for (const s of [400, 403, 404, 415, 500, 502, 'offline']) assert.doesNotMatch(errorText(s), /\d{3}|Request failed/);
});
