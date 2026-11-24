// Unsorted: picking a pot saves it (as a rule, by hand, or as your own account), and Undo takes exactly that back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixture.js';

const { api, categories, db } = await setup({
  today: '2026-10-16',
  config: { categories: ['Groceries', 'Eating out', 'Transfers'], transferCategory: 'Transfers' },
  txs: [
    { date: '2026-10-01', cents: -1234, who: 'Bakery Example' },
    { date: '2026-10-02', cents: -2345, who: 'Bakery Example' },
    { date: '2026-10-03', cents: -500, desc: 'CARD PAYMENT CAFE ONE' },
    { date: '2026-10-04', cents: -700, desc: 'CARD PAYMENT CAFE TWO' },
    { date: '2026-10-05', cents: -10000, who: 'Jane Doe', iban: 'BE00 0000 0000 0099' },
  ],
});
const post = (path, body) => api.api('POST', path, new URLSearchParams(), body);
const idsOf = (pattern) => db.prepare('SELECT id FROM transactions WHERE counterparty LIKE ? OR description LIKE ?').all(pattern, pattern).map((r) => r.id);
const categoryOf = (ids) => ids.map((id) => db.prepare('SELECT category FROM transactions WHERE id = ?').get(id).category);

test('a rule from Unsorted sorts the merchant, and Undo removes the rule again', async () => {
  const ids = idsOf('%Bakery%');
  const res = await post('/api/review', { ids, category: 'Groceries', mode: 'rule', match: 'bakery example', orManual: true });
  assert.equal(res.mode, 'rule');
  assert.deepEqual(categoryOf(ids), ['Groceries', 'Groceries']);
  assert.equal(categories.loadConfig().rules.length, 1);

  await post('/api/review/undo', res.undo);
  assert.deepEqual(categoryOf(ids), [null, null]);
  assert.equal(categories.loadConfig().rules.length, 0);
});

test('a rule text that isn’t in every transaction sorts them by hand instead, and Undo clears them', async () => {
  const ids = idsOf('%CAFE%');
  await assert.rejects(post('/api/review', { ids, category: 'Eating out', mode: 'rule', match: 'cafe one' }), /doesn't appear/);

  const res = await post('/api/review', { ids, category: 'Eating out', mode: 'rule', match: 'cafe one', orManual: true });
  assert.equal(res.mode, 'manual');
  assert.deepEqual(categoryOf(ids), ['Eating out', 'Eating out']);
  assert.equal(categories.loadConfig().rules.length, 0);

  await post('/api/review/undo', res.undo);
  assert.deepEqual(categoryOf(ids), [null, null]);
});

test('marking an IBAN as your own account can be undone', async () => {
  const ids = idsOf('%Jane%');
  const res = await post('/api/review', { ids, category: 'Transfers', mode: 'own' });
  assert.deepEqual(categoryOf(ids), ['Transfers']);

  await post('/api/review/undo', res.undo);
  assert.deepEqual(categoryOf(ids), [null]);
  assert.deepEqual(categories.loadConfig().ownIbans ?? [], []);
});

test('an undo with the wrong shape is refused', async () => {
  for (const body of [{}, { mode: 'own', ibans: [1] }, { mode: 'manual', ids: [] }, { mode: 'rule', match: 3, category: 'Groceries' }]) {
    await assert.rejects(post('/api/review/undo', body), /Nothing to undo/, JSON.stringify(body));
  }
});
