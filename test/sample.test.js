// Sample data: always up to today, never mixed with your own bank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setup } from './fixture.js';

const { api, db } = await setup({ today: '2026-11-07' });
const seed = (...args) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/seed.js', ...args], { env: process.env });
const count = (where) => db.prepare(`SELECT count(*) AS n FROM transactions WHERE ${where}`).get().n;

test('the sample runs from three months back up to today, so the Overview opens on a month with data', () => {
  seed();
  const { first, last } = db.prepare('SELECT min(booking_date) AS first, max(booking_date) AS last FROM transactions').get();
  assert.equal(first.slice(0, 7), '2026-08');
  assert.ok(last <= '2026-11-07', 'nothing after today');
  assert.ok(count("booking_date LIKE '2026-11-%'") > 0, 'this month has some');
  assert.ok(api.overview().month, 'the Overview has a month to show');
});

test('every sample IBAN is a BE00 placeholder', () => {
  const ibans = db.prepare(`SELECT iban FROM accounts WHERE uid LIKE 'sample-%'
    UNION SELECT counterparty_iban FROM transactions WHERE counterparty_iban IS NOT NULL`).all().map((r) => r.iban);
  assert.ok(ibans.length > 3);
  for (const iban of ibans) assert.match(iban, /^BE00/);
});

test('seeding again replaces the sample instead of doubling it', () => {
  const before = count('1');
  seed();
  assert.equal(count('1'), before);
});

test('linking your own bank removes the sample data', async () => {
  const { saveSession } = await import('../src/linking.js');
  saveSession({ session_id: 's1', accounts: [{ uid: 'acc-1', account_id: { iban: 'BE00 0000 0000 0909' }, name: 'Jane Doe', currency: 'EUR' }] }, 'Bank A', '2027-05-01');
  assert.equal(count("account_uid LIKE 'sample-%'"), 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM accounts WHERE uid LIKE 'sample-%'").get().n, 0);
  assert.ok(db.prepare("SELECT 1 FROM accounts WHERE uid = 'acc-1'").get(), 'your own account is in');
});

test('once your own bank is in, the app won’t add sample data', async () => {
  await assert.rejects(api.api('POST', '/api/setup/sample', new URLSearchParams(), {}), /before your own bank/);
  assert.equal(count("account_uid LIKE 'sample-%'"), 0);
});

test('removing the sample leaves nothing behind', () => {
  seed();
  seed('--remove');
  assert.equal(count("account_uid LIKE 'sample-%'"), 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE id = 'sample-session'").get().n, 0);
});
