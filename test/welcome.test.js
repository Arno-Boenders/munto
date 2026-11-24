// The setup guide (/welcome) opens by itself on a first start only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setup } from './fixture.js';

const { api, db } = await setup({ today: '2026-11-18' });
const seed = (...args) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/seed.js', ...args], { env: process.env });
const noAccounts = () => { db.exec('DELETE FROM transactions'); db.exec('DELETE FROM accounts'); db.exec('DELETE FROM sessions'); };

test('not once a bank is connected', async () => {
  assert.equal(await api.needsWelcome(), false);
});

test('on a first start: no bank and no sample data', async () => {
  noAccounts();
  assert.equal(await api.needsWelcome(), true);
});

test('not while you look around with the sample data', async () => {
  seed();
  assert.equal(await api.needsWelcome(), false);
  seed('--remove');
  assert.equal(await api.needsWelcome(), true);
});

test('not again once it was finished or skipped', async () => {
  noAccounts();
  assert.deepEqual(await api.api('POST', '/api/setup/welcome', new URLSearchParams(), {}), { ok: true });
  assert.equal(await api.needsWelcome(), false);
});

test('the setup state tells the guide how many are left to sort', async () => {
  const state = await api.api('GET', '/api/setup', new URLSearchParams(), null);
  assert.equal(state.uncategorised, 0);
  assert.deepEqual(state.banks, []);
});
