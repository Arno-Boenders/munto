// Walks you through uncategorised transactions, one merchant at a time (most frequent first).
// Saying "yes" to "make this a rule" means you'll never be asked about that merchant again.
// (The web UI, `npm run ui`, has the same flow on its Review page.)
//
//   npm run review            rules only
//   npm run review -- --ai    also show a suggestion from Claude for each merchant
import { createInterface } from 'node:readline';
import {
  addCategory, addOwnIbans, addRule, applyRules, groupUncategorised, loadConfig, matchesAll, normIban, setManualCategory,
} from './categories.js';
import { db } from './db.js';
import { safe } from './terminal.js';

const useAi = process.argv.includes('--ai');
const fmt = (cents) => (cents / 100).toFixed(2);
const isOpen = db.prepare('SELECT category IS NULL AS open FROM transactions WHERE id = ?');

applyRules();
const groups = groupUncategorised();
if (groups.length === 0) {
  console.log('Everything is categorised.');
  process.exit(0);
}

let suggestions = new Map();
if (useAi) {
  const { suggestCategories, suggestionInput, aiName } = await import('./suggest.js');
  const { aiSettings } = await import('./ai.js');
  process.stdout.write(`Asking ${aiName()} for suggestions... `);
  try {
    suggestions = await suggestCategories(suggestionInput(groups, { amounts: aiSettings().sendAmounts }), loadConfig().categories);
    console.log(`got ${suggestions.size}.`);
  } catch (err) {
    console.log(`failed.\n${err.message}\nContinuing without suggestions.`);
  }
}

// Reads answers line by line; works both interactively and with piped input.
const rl = createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  return done ? 'q' : value.trim();
}

const printCategories = () =>
  console.log('\n' + loadConfig().categories.map((c, i) => `${String(i + 1).padStart(2)}. ${c}`).join('\n'));

let rulesAdded = 0;
let manual = 0;

console.log(`${groups.reduce((n, g) => n + g.txs.length, 0)} uncategorised transactions from ${groups.length} merchants.`);
printCategories();

for (const [index, group] of groups.entries()) {
  const { key } = group;
  // A rule added earlier in this session (e.g. a shorter match) may already cover this merchant.
  const txs = group.txs.filter((t) => isOpen.get(t.id).open);
  if (txs.length === 0) continue;

  const total = txs.reduce((sum, t) => sum + t.amount_cents, 0);
  console.log(`\n[${index + 1}/${groups.length}] ${safe(key)}  (${txs.length}×, total ${fmt(total)} EUR)`);
  for (const t of txs.slice(0, 3)) {
    console.log(`   ${t.booking_date}  ${fmt(t.amount_cents).padStart(9)}  ${safe(t.description ?? '')}`);
  }

  const { categories, transferCategory } = loadConfig();
  const suggestion = suggestions.get(key)?.category;
  const hint = suggestion ? `Enter = ${suggestion}, ` : '';
  let category;
  let quit = false;
  while (!category) {
    const answer = await ask(`   Category? (${hint}number, new name, ? = list, s = skip, q = quit): `);
    if (answer === 'q') { quit = true; break; }
    if (answer === 's') break;
    if (answer === '?') { printCategories(); continue; }
    if (answer === '' && suggestion) category = suggestion;
    else if (/^\d+$/.test(answer) && categories[Number(answer) - 1]) category = categories[Number(answer) - 1];
    else if (answer.length > 1) {
      category = categories.find((c) => c.toLowerCase() === answer.toLowerCase()) ?? answer;
      if (!categories.includes(category)) {
        addCategory(category);
        console.log(`   Added new category "${category}"`);
      }
    }
  }
  if (quit) break;
  if (!category) continue;

  // Transfers to your own (unlinked) accounts: remember the IBANs rather than the name.
  const ibans = [...new Set(txs.map((t) => t.counterparty_iban).filter(Boolean).map(normIban))];
  if (category === transferCategory && ibans.length > 0) {
    const answer = await ask(`   Are ${safe(ibans.join(', '))} your own accounts? (Y/n): `);
    if (answer.toLowerCase() !== 'n') {
      addOwnIbans(ibans);
      rulesAdded++;
      continue;
    }
  }

  let pattern;
  for (;;) {
    const answer = await ask(`   Always put "${safe(key)}" in ${safe(category)}? (Y/n, or type a shorter match like "${safe(key.split(' ')[0].toLowerCase())}"): `);
    if (['', 'y', 'yes'].includes(answer.toLowerCase())) pattern = key;
    else if (answer.toLowerCase() === 'n') pattern = null;
    else if (matchesAll(answer, txs)) pattern = answer;
    else { console.log(`   "${answer}" doesn't appear in all of these transactions; try again.`); continue; }
    break;
  }
  if (pattern) {
    addRule(pattern, category);
    rulesAdded++;
  } else {
    setManualCategory(txs.map((t) => t.id), category);
    manual += txs.length;
  }
}

rl.close();
const remaining = db.prepare('SELECT count(*) AS n FROM transactions WHERE category IS NULL').get().n;
console.log(`\nAdded ${rulesAdded} rules, categorised ${manual} transactions by hand. ${remaining} left uncategorised.`);
