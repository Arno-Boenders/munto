// Bank text printed by the command-line tools can't steer the terminal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safe } from '../src/terminal.js';

const ESC = String.fromCharCode(27);

test('control characters become a visible ?', () => {
  assert.equal(safe('Bakery'), 'Bakery');
  assert.equal(safe('Café €12.34'), 'Café €12.34');
  assert.equal(safe(`a${ESC}[2Jb`), 'a?[2Jb');
  assert.equal(safe(`x${String.fromCharCode(7, 0x9b, 13, 10, 0x2028)}y`), 'x?????y');
  assert.equal(safe(null), '');
});
