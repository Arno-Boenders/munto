// Rule-based categorisation. Rules live in config/categories.json so you can read and edit them;
// `npm run review` adds to them as you categorise new merchants.
//
// A rule is { match, category, direction? }:
//   match      case-insensitive regex, tested against "<counterparty> <description>"
//   direction  optional "in" (money received) or "out" (money spent)
// The first matching rule wins, so put specific rules above general ones.
// Transactions you categorise by hand (category_source = 'manual') are never overwritten.
// Money moving between your own accounts (linked ones, plus the IBANs in "ownIbans") goes to
// "transferCategory" and is left out of the report.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROJECT, configPath, privateDir, privateFile } from './paths.js';
import { db } from './db.js';

if (process.env.NODE_TEST_CONTEXT && !process.env.CONFIG_PATH) throw new Error('Tests must set CONFIG_PATH (import test/fixture.js and await setup() first)');
const CONFIG_PATH = configPath(); // the app's data folder (see paths.js), or CONFIG_PATH for tests

// Your own config holds your rules and IBANs, so it isn't in git; start from the example.
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) { privateDir(dirname(CONFIG_PATH)); copyFileSync(join(PROJECT, 'config', 'categories.example.json'), CONFIG_PATH); privateFile(CONFIG_PATH); }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

export function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

// What counts as income and when the month starts. Older configs kept paydayFromDay at the top level.
//   salary                merchant keys whose payments start the month (empty: the biggest income payment)
//   paydayFromDay         the salary lands on or after this day of the month before; 0 = calendar months
//   expectedMonthlyCents  what you expect to earn a month, or null
export function incomeSettings(config = loadConfig()) {
  const income = config.income ?? {};
  return {
    salary: income.salary ?? [],
    paydayFromDay: income.paydayFromDay ?? config.paydayFromDay ?? 0,
    expectedMonthlyCents: income.expectedMonthlyCents ?? null,
  };
}

export function saveIncomeSettings(changes) {
  const config = loadConfig();
  config.income = { ...incomeSettings(config), ...changes };
  delete config.paydayFromDay;
  saveConfig(config);
  return config.income;
}

// Pages you can switch off under Settings. A config from before there were features has them all on;
// a new one (from categories.example.json) starts with the ones not everyone needs off.
export const FEATURES = ['trends', 'savings', 'cut', 'rules'];
export function featureSettings(config = loadConfig()) {
  return Object.fromEntries(FEATURES.map((f) => [f, config.features?.[f] !== false]));
}

export function saveFeatures(changes) {
  const config = loadConfig();
  config.features = { ...featureSettings(config) };
  for (const f of FEATURES) if (typeof changes[f] === 'boolean') config.features[f] = changes[f];
  saveConfig(config);
  return config.features;
}

// A rule for one payer's incoming money, put first so it wins over the general rules.
// Returns false when the merchant name isn't in all its transactions (then they're set by hand).
export function setIncomingCategory(key, txs, category) {
  const match = key.toLowerCase();
  const config = withCategory(loadConfig(), category);
  const pattern = escapeRegex(match.trim());
  config.rules = config.rules.filter((r) => !(r.match === pattern && r.direction === 'in'));
  const asRule = matchesAll(match, txs);
  if (asRule) config.rules.unshift({ match: pattern, category, direction: 'in' });
  saveConfig(config);
  // Hand-set ones (and, without a rule, all of them) are set directly.
  const byHand = txs.filter((t) => !asRule || t.category_source === 'manual').map((t) => t.id);
  if (byHand.length) setManualCategory(byHand, category);
  applyRules();
  return asRule;
}

export const normIban = (iban) => iban.replace(/\s/g, '').toUpperCase();

// Some payers carry many things: every PayPal payment just says "PayPal", an app store's one name is its cloud
// storage but also every app you buy. A subscription can then also be told apart by its amount (`byAmount`: within 5%, so
// €9,00 and €9,50 stay apart) and, for monthly and quarterly ones, the day of the month it's charged
// (`day`, give or take 4 days for weekends and bank delays).
const dayGap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 31 - d); };
export function fitsSub(sub, t) {
  if (sub.byAmount && Math.abs(-t.amount_cents - sub.amountCents) > Math.max(20, sub.amountCents * 0.05)) return false;
  if (sub.day && sub.every !== 'week' && sub.every !== 'year' && dayGap(Number(t.booking_date.slice(8, 10)), sub.day) > 4) return false;
  return true;
}

function compile(config) {
  // Rules with an amount are the more specific ones, so they go first ("app store, €1,00" before
  // "app store"); otherwise the first match wins, in the order you added them.
  const all = config.rules.map((rule) => ({ ...rule, re: new RegExp(rule.match, 'i') }));
  const rules = [...all.filter((r) => r.amountCents != null), ...all.filter((r) => r.amountCents == null)];
  // A subscription sorts its own payments into its pot, before any rule: so a cloud storage
  // plan goes to Subscriptions while the apps you buy from the same store can go elsewhere.
  const subscriptions = (config.subscriptions ?? []).filter((s) => s.match && s.category);
  const linked = db.prepare('SELECT iban FROM accounts WHERE iban IS NOT NULL').all().map((r) => r.iban);
  const ownIbans = new Set([...linked, ...(config.ownIbans ?? [])].map(normIban));
  return { rules, subscriptions, ownIbans, transferCategory: config.transferCategory };
}

function categoryFor(tx, { rules, subscriptions = [], ownIbans, transferCategory }) {
  // Money moving between your own accounts isn't spending; keep it out of budgets.
  if (transferCategory && tx.counterparty_iban && ownIbans.has(normIban(tx.counterparty_iban))) {
    return transferCategory;
  }
  const text = `${tx.counterparty ?? ''} ${tx.description ?? ''}`;
  const direction = tx.amount_cents < 0 ? 'out' : 'in';
  if (direction === 'out' && tx.booking_date) {
    const lower = text.toLowerCase();
    const sub = subscriptions.find((s) => lower.includes(s.match.toLowerCase()) && fitsSub(s, tx));
    if (sub) return sub.category;
  }
  for (const rule of rules) {
    if (rule.direction && rule.direction !== direction) continue;
    if (rule.amountCents != null && Math.abs(tx.amount_cents) !== rule.amountCents) continue;
    if (rule.re.test(text)) return rule.category;
  }
  return null;
}

// (Re)applies the rules to every transaction that wasn't categorised by hand.
// Returns how many transactions are categorised by rules and how many are still uncategorised.
export function applyRules() {
  const compiled = compile(loadConfig());
  const transactions = db
    .prepare(`
      SELECT id, booking_date, amount_cents, counterparty, counterparty_iban, description FROM transactions
      WHERE category_source IS NULL OR category_source = 'rule'
    `)
    .all();
  const update = db.prepare('UPDATE transactions SET category = ?, category_source = ? WHERE id = ?');

  let matched = 0;
  db.exec('BEGIN');
  try {
    for (const tx of transactions) {
      const category = categoryFor(tx, compiled);
      update.run(category, category ? 'rule' : null, tx.id);
      if (category) matched++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { matched, uncategorised: transactions.length - matched };
}

const BELGIAN_CITIES = new Set([
  'GENT', 'ANTWERPEN', 'BRUSSEL', 'BRUXELLES', 'LEUVEN', 'BRUGGE', 'MECHELEN', 'HASSELT',
  'KORTRIJK', 'AALST', 'GENK', 'OOSTENDE', 'SINT-NIKLAAS', 'ROESELARE', 'LIEGE', 'NAMUR',
]);

// Groups transactions from the same merchant, e.g. both of these become "CAFE EXAMPLE":
//   "BETALING MET DEBETKAART NUMMER 1234 56XX XXXX 1234 CAFE EXAMPLE LEUVEN 12-08-2026 OM 21.14 UUR"
//   "BETALING MET DEBETKAART NUMMER 1234 56XX XXXX 1234 CAFE EXAMPLE LEUVEN 30-09-2026 OM 22.40 UUR"
export function merchantKey(tx) {
  // "ACME S.A." and "ACME SA" are the same payer: drop company-form suffixes.
  if (tx.counterparty) {
    const name = tx.counterparty.trim().toUpperCase();
    return name.replace(/[\s,]+(S\.?A|N\.?V|B\.?V|BVBA|SRL|SPRL)\.?$/, '') || name;
  }
  const words = (tx.description ?? '')
    .toUpperCase()
    .replace(/^BETALING MET (DEBETKAART|BANKKAART|KREDIETKAART) NUMMER [\dX ]+/, '')
    .replace(/\d{2}[-/]\d{2}[-/]\d{4}.*$/, '') // date and everything after it
    .replace(/\d+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1 && BELGIAN_CITIES.has(words.at(-1))) words.pop();
  return words.slice(0, 4).join(' ') || '(no description)';
}

export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Uncategorised transactions grouped by merchant, most frequent first.
export function groupUncategorised() {
  const groups = new Map();
  for (const tx of db.prepare('SELECT * FROM transactions WHERE category IS NULL ORDER BY booking_date DESC').all()) {
    const key = merchantKey(tx);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  return [...groups.entries()]
    .map(([key, txs]) => ({ key, txs }))
    .sort((a, b) => b.txs.length - a.txs.length);
}

const searchText = (tx) => `${tx.counterparty ?? ''} ${tx.description ?? ''}`.toLowerCase();

// A custom match must appear in every transaction it's meant for, so a typo can't become a rule.
export const matchesAll = (pattern, txs) =>
  pattern.trim().length >= 3 && txs.every((tx) => searchText(tx).includes(pattern.trim().toLowerCase()));

// A pot name is plain text: not empty, not huge, and never a name that means something to JavaScript objects
// (budgets and funds are stored by pot name).
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export function checkCategory(category) {
  if (typeof category !== 'string' || !category.trim() || category.length > 80 || RESERVED.has(category)) {
    throw Object.assign(new Error('That isn’t a usable pot name'), { status: 400 });
  }
  return category;
}

function withCategory(config, category) {
  checkCategory(category);
  if (!config.categories.includes(category)) config.categories.push(category);
  return config;
}

export function addCategory(category) {
  saveConfig(withCategory(loadConfig(), category));
}

// Adds a "contains <text>" rule and re-applies all rules.
// amountCents (optional): only payments of exactly that amount, in or out.
export function addRule(text, category, { amountCents = null } = {}) {
  const config = withCategory(loadConfig(), category);
  config.rules.push({ match: escapeRegex(text.trim().toLowerCase()), category, ...(amountCents != null ? { amountCents } : {}) });
  saveConfig(config);
  return applyRules();
}

export function deleteRule(index) {
  const config = loadConfig();
  config.rules.splice(index, 1);
  saveConfig(config);
  return applyRules();
}

// Puts a deleted rule back at its old place (or at the end, if the list has since become shorter).
export function restoreRule(index, { match, category, direction, amountCents }) {
  // Every rule runs on every sync: one that isn't a valid pattern would stop them all.
  try { new RegExp(match, 'i'); } catch { throw Object.assign(new Error('That rule can’t be put back'), { status: 400 }); }
  const config = withCategory(loadConfig(), category);
  const rule = { match, category, ...(direction === 'in' || direction === 'out' ? { direction } : {}), ...(Number.isInteger(amountCents) ? { amountCents } : {}) };
  config.rules.splice(Math.min(index, config.rules.length), 0, rule);
  saveConfig(config);
  return applyRules();
}

export function addOwnIbans(ibans) {
  const config = loadConfig();
  config.ownIbans = [...new Set([...(config.ownIbans ?? []), ...ibans.map(normIban)])];
  saveConfig(config);
  return applyRules();
}

export function removeOwnIbans(ibans) {
  const config = loadConfig();
  const gone = new Set(ibans.map(normIban));
  config.ownIbans = (config.ownIbans ?? []).filter((i) => !gone.has(normIban(i)));
  saveConfig(config);
  return applyRules();
}

// Categorises specific transactions by hand; rules will never overwrite these.
export function setManualCategory(ids, category) {
  if (category) saveConfig(withCategory(loadConfig(), category));
  const update = db.prepare('UPDATE transactions SET category = ?, category_source = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const id of ids) update.run(category || null, category ? 'manual' : null, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // Clearing a category hands the transaction back to the rules.
  if (!category) applyRules();
}
