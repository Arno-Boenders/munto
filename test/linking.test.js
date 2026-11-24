// Linking a bank: reading the redirect, finishing a link, and renewing without downloading anything twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixture.js';

const { db } = await setup({ today: '2026-10-16' });
const { fromCallback, finishLink, linkStatus, saveSession } = await import('../src/linking.js');

// A bank account and a PayPal account as `npm run link` saved them, with transactions (ids start with the uid).
db.exec(`INSERT INTO sessions (id, bank, valid_until) VALUES ('old-bank', 'Bank A', '2026-10-20'), ('old-pp', 'PayPal', '2026-10-20');
  INSERT INTO accounts (uid, session_id, bank, iban, name, currency, last_synced) VALUES
    ('bank-1', 'old-bank', 'Bank A', 'BE33000000000033', 'ME', 'EUR', '2026-10-15'),
    ('pp-1', 'old-pp', 'PayPal', NULL, 'Me', 'XXX', '2026-10-15');`);
const tx = db.prepare(`INSERT INTO transactions (id, account_uid, booking_date, amount_cents, currency, counterparty, status, category, category_source, mirror_of, raw)
  VALUES (?, ?, ?, ?, 'EUR', ?, 'BOOK', ?, ?, ?, '{}')`);
tx.run('pp-1:A1', 'pp-1', '2026-09-20', -1000, 'Streamly AB', 'Subscriptions', 'rule', null);
tx.run('bank-1:B1', 'bank-1', '2026-09-22', -1000, 'PayPal Europe', 'Savings & transfers', 'mirror', 'pp-1:A1');
tx.run('bank-1:B2', 'bank-1', '2026-09-23', -4000, 'SUPERMARKET', 'Groceries', 'manual', null);

test('the code and state come from the address the bank sent you to', () => {
  assert.deepEqual(fromCallback('https://localhost:3443/callback?state=s1&code=c1'), { code: 'c1', state: 's1' });
  assert.throws(() => fromCallback('https://localhost:3443/callback?state=s1&error=access_denied&error_description=You%20cancelled'), /You cancelled/);
  assert.throws(() => fromCallback('https://localhost:3443/callback?state=s1'), /no code/);
  assert.throws(() => fromCallback('not an address'), /doesn’t look like/);
});

test('a link must have been started here, and in the last 15 minutes', async () => {
  await assert.rejects(finishLink({ code: 'c', state: 'never-started' }, async () => ({})), /expired or wasn’t started/);
  assert.equal(linkStatus('never-started').status, 'unknown');
});

test('renewing moves your accounts to the new ids, with their transactions and PayPal links', () => {
  const bank = saveSession({ session_id: 'new-bank', access: { valid_until: '2027-04-01' }, accounts: [{ uid: 'bank-2', account_id: { iban: 'BE33 0000 0000 0033' }, name: 'ME', currency: 'EUR' }] }, 'Bank A', '2027-04-01');
  assert.deepEqual(bank.accounts.map((a) => [a.uid, a.renewed]), [['bank-2', true]]);
  const pp = saveSession({ session_id: 'new-pp', accounts: [{ uid: 'pp-2', name: 'Me', currency: 'XXX' }] }, 'PayPal', '2027-04-16');
  assert.equal(pp.accounts[0].renewed, true, 'PayPal has no IBAN: matched by bank and name');
  const rows = db.prepare('SELECT id, account_uid, category, category_source, mirror_of FROM transactions ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { id: 'bank-2:B1', account_uid: 'bank-2', category: 'Savings & transfers', category_source: 'mirror', mirror_of: 'pp-2:A1' },
    { id: 'bank-2:B2', account_uid: 'bank-2', category: 'Groceries', category_source: 'manual', mirror_of: null },
    { id: 'pp-2:A1', account_uid: 'pp-2', category: 'Subscriptions', category_source: 'rule', mirror_of: null },
  ]);
  const accounts = db.prepare("SELECT uid, session_id, last_synced FROM accounts WHERE uid NOT LIKE 'a1' ORDER BY uid").all().map((r) => ({ ...r }));
  assert.deepEqual(accounts, [
    { uid: 'bank-2', session_id: 'new-bank', last_synced: '2026-10-15' },
    { uid: 'pp-2', session_id: 'new-pp', last_synced: '2026-10-15' },
  ], 'the next sync carries on where the old account left off');
  const sessions = db.prepare('SELECT id, valid_until FROM sessions ORDER BY id').all().map((r) => `${r.id} ${r.valid_until}`);
  assert.deepEqual(sessions, ['new-bank 2027-04-01', 'new-pp 2027-04-16', 's1 2099-01-01'], 'old sessions without accounts are gone');
});

test('a new bank is just added; no accounts back means restricted mode', () => {
  const kbc = saveSession({ session_id: 'kbc', accounts: [{ uid: 'kbc-1', account_id: { iban: 'BE68539007547034' }, name: 'ME', currency: 'EUR' }] }, 'KBC', '2027-01-01');
  assert.equal(kbc.accounts[0].renewed, false);
  assert.throws(() => saveSession({ session_id: 'x', accounts: [] }, 'PayPal', '2027-01-01'), /control panel/);
});

test('only an https bank page is ever opened', async () => {
  const { isHttps } = await import('../src/linking.js');
  assert.equal(isHttps('https://tilisy.enablebanking.com/welcome?x=1'), true);
  for (const bad of ['javascript:alert(1)', 'http://example.com', 'data:text/html,hi', 'file:///etc/passwd', '', 'not a url']) assert.equal(isHttps(bad), false, bad);
});
