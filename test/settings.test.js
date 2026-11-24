// Enable Banking settings: from the Setup page (settings.json + key in the data folder), .env still wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './fixture.js';

const { dir } = await setup({ today: '2026-10-16' });
const { checkEnableBanking, enableBanking, isConfigured, saveEnableBanking, DEFAULT_REDIRECT } = await import('../src/settings.js');
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('nothing set up yet', () => {
  const eb = enableBanking({});
  assert.deepEqual([eb.appId, eb.keyPath, eb.country, eb.redirectUrl, eb.source], [null, null, 'BE', DEFAULT_REDIRECT, null]);
  assert.equal(isConfigured(eb), false);
});

test('what you paste is checked before anything is saved', () => {
  assert.throws(() => checkEnableBanking({ appId: 'not-an-id', keyPem: pem }), /8-4-4-4-12/);
  assert.throws(() => checkEnableBanking({ appId: ID, keyPem: 'hello' }), /private key/);
  assert.throws(() => checkEnableBanking({ appId: ID, keyPem: pem, redirectUrl: 'http://localhost/callback' }), /https/);
  const ok = checkEnableBanking({ appId: ` ${ID.toUpperCase()} `, keyPem: pem, country: 'be' });
  assert.deepEqual([ok.appId, ok.country, ok.redirectUrl], [ID, 'BE', DEFAULT_REDIRECT]);
});

test('saved in the data folder, private, and used from then on', () => {
  saveEnableBanking(checkEnableBanking({ appId: ID, keyPem: pem, country: 'NL' }));
  const eb = enableBanking({});
  assert.deepEqual([eb.appId, eb.keyPath, eb.country, eb.source], [ID, join(dir, 'enablebanking.pem'), 'NL', 'settings']);
  assert.ok(isConfigured(eb));
  assert.ok(readFileSync(eb.keyPath, 'utf8').includes('PRIVATE KEY'));
  if (process.platform !== 'win32') {
    assert.equal(statSync(eb.keyPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'settings.json')).mode & 0o777, 0o600);
  }
});

test('.env still wins, so an existing setup keeps working', () => {
  const eb = enableBanking({ EB_APP_ID: 'from-env', EB_COUNTRY: 'BE', EB_PRIVATE_KEY_PATH: '/keys/eb.pem' });
  assert.deepEqual([eb.appId, eb.country, eb.keyPath, eb.source], ['from-env', 'BE', '/keys/eb.pem', '.env']);
});

test('a key set up the .env way is made private', { skip: process.platform === 'win32' }, () => {
  const key = join(dir, 'env-key.pem');
  writeFileSync(key, pem, { mode: 0o644 });
  enableBanking({ EB_APP_ID: ID, EB_PRIVATE_KEY_PATH: key });
  assert.equal(statSync(key).mode & 0o777, 0o600);
});
