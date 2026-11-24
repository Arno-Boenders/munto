import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtMoney, parseEuros, signed } from '../lib/format.js';

test('parseEuros reads the ways people type amounts', () => {
  assert.equal(parseEuros('10,99'), 1099);
  assert.equal(parseEuros('€ 2.500'), 250000); // a dot between thousands
  assert.equal(parseEuros('2.500,50'), 250050);
  assert.equal(parseEuros('2 500'), 250000);
  assert.equal(parseEuros('12.5'), 1250); // a dot as decimal point when it can't be thousands
  assert.equal(parseEuros('100'), 10000);
  assert.equal(parseEuros('0,1'), 10);
});

test('parseEuros says null when it is not an amount', () => {
  assert.equal(parseEuros(''), null);
  assert.equal(parseEuros('abc'), null);
  assert.equal(parseEuros(null), null);
});

test('money is shown the Belgian way, with a real minus', () => {
  const clean = (s) => s.replace(/\s/g, ' ');
  assert.equal(clean(fmtMoney(123456)), '€ 1.234,56');
  assert.equal(clean(fmtMoney(-500)), '−€ 5,00');
  assert.equal(clean(signed(500)), '+€ 5,00');
});

test('ruleWords shows a rule as words, and anything more regex as written', async () => {
  const { ruleWords } = await import('../lib/format.js');
  assert.deepEqual(ruleWords('\\bloon\\b|salaris'), [{ text: 'loon', whole: true }, { text: 'salaris', whole: false }]);
  assert.deepEqual(ruleWords('booking\\.com|\\bhotel|octa\\+'), [{ text: 'booking.com', whole: false }, { text: 'hotel', whole: false }, { text: 'octa+', whole: false }]);
  assert.deepEqual(ruleWords('wizz ?air|\\bcaf[eé]\\b'), [{ text: 'wizz ?air', raw: true }, { text: '\\bcaf[eé]\\b', raw: true }]);
  assert.deepEqual(ruleWords('(a|b)c'), [{ text: '(a|b)c', raw: true }]);
  assert.deepEqual(ruleWords('immo '), [{ text: 'immo ', whole: false }]);
});
