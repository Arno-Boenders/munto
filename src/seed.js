// Fills the database with realistic Belgian sample transactions, from three months back up to today, so you
// can look around before linking a real bank. Re-running replaces the sample data; your real accounts are
// never touched, and linking your own bank removes it (src/linking.js).
//
//   npm run seed              (re)create sample data
//   npm run seed -- --remove  delete sample data
//
// Everything in it is made up: the people, the IBANs (all BE00…, which no real account has) and the shops
// that aren't big chains.
import { db } from './db.js';
import { applyRules } from './categories.js';
import { SAMPLE_SESSION, removeSampleData } from './sample.js';

const CHECKING = { uid: 'sample-checking', iban: 'BE00000000000101', name: 'Zichtrekening (sample)' };
const SAVINGS = { uid: 'sample-savings', iban: 'BE00000000000202', name: 'Spaarrekening (sample)' };

if (process.argv.includes('--remove')) {
  removeSampleData();
  console.log('Sample data removed.');
  process.exit(0);
}

// Deterministic pseudo-random numbers, so every seed produces the same data.
let state = 20260701;
const random = () => {
  state = (state * 1664525 + 1013904223) % 2 ** 32;
  return state / 2 ** 32;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const between = (min, max) => Math.round((min + random() * (max - min)) * 100);

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const be = (y, m, d) => `${pad(d)}-${pad(m)}-${y}`;
const card = (merchant, city, y, m, d) =>
  `BETALING MET DEBETKAART NUMMER 1234 56XX XXXX 1234 ${merchant} ${city} ${be(y, m, d)} OM ${pad(8 + Math.floor(random() * 13))}.${pad(Math.floor(random() * 60))} UUR`;

// The three months before this one, and this one up to today: the Overview always opens on a month with data.
// BUDGET_TODAY pins the date, as it does for the app (src/api.js).
const today = process.env.BUDGET_TODAY || new Date().toISOString().slice(0, 10);
const now = new Date(`${today}T12:00:00`);
const MONTHS = [3, 2, 1, 0].map((back) => {
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return [d.getFullYear(), d.getMonth() + 1];
});
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const MONTH_NAMES = [, 'JANUARI', 'FEBRUARI', 'MAART', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AUGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DECEMBER'];
const CITIES = ['ANTWERPEN', 'BRUSSEL', 'LEUVEN', 'MECHELEN', 'HASSELT', 'BRUGGE'];

const transactions = [];
const add = (account, date, cents, { counterparty = null, iban = null, description }) => {
  if (date <= today) transactions.push({ account, date, cents, counterparty, iban, description });
};

MONTHS.forEach(([y, m], i) => {
  // Fixed monthly income and bills
  add(CHECKING, iso(y, m, 1), -87500, { counterparty: 'Immo Voorbeeld BV', iban: 'BE00000000000303', description: `HUUR ${MONTH_NAMES[m]} ${y} APPARTEMENT 2B` });
  add(CHECKING, iso(y, m, 2), -2999, { counterparty: 'BASIC-FIT BELGIUM', description: 'DOMICILIERING BASIC-FIT LIDMAATSCHAP' });
  add(CHECKING, iso(y, m, 5), -5999, { counterparty: 'PROXIMUS NV', description: `DOMICILIERING PROXIMUS FACTUUR ${y}${pad(m)}0512` });
  add(CHECKING, iso(y, m, 10), -11200, { counterparty: 'ENGIE ELECTRABEL', description: 'DOMICILIERING VOORSCHOTFACTUUR ENERGIE' });
  add(CHECKING, iso(y, m, 11), -3850, { counterparty: 'FARYS', description: 'DOMICILIERING WATERFACTUUR' });
  add(CHECKING, iso(y, m, 12), -1199, { description: card('SPOTIFY P2A1B3C', 'STOCKHOLM', y, m, 12) });
  add(CHECKING, iso(y, m, 15), -4230, { counterparty: 'AG INSURANCE', description: 'DOMICILIERING FAMILIALE EN BRANDVERZEKERING' });
  add(CHECKING, iso(y, m, 18), -1349, { description: card('NETFLIX.COM', 'AMSTERDAM', y, m, 18) });
  add(CHECKING, iso(y, m, 25), 265000, { counterparty: 'ACME BELGIUM NV', iban: 'BE00000000000404', description: `LOON ${pad(m)}/${y}` });
  add(CHECKING, iso(y, m, 21), -2500, { counterparty: 'VZW SPORTCLUB DE LOPERS', iban: 'BE00000000000505', description: 'LIDGELD + KLEDIJ' });

  // Monthly savings transfer between own accounts (appears on both)
  add(CHECKING, iso(y, m, 26), -30000, { counterparty: 'J. Peeters', iban: SAVINGS.iban, description: 'SPAREN' });
  add(SAVINGS, iso(y, m, 26), 30000, { counterparty: 'J. Peeters', iban: CHECKING.iban, description: 'SPAREN' });

  // Variable day-to-day spending
  for (let d = 1; d <= daysIn(y, m); d++) {
    if (random() < 0.33) add(CHECKING, iso(y, m, d), -between(12, 95), { description: card(pick(['DELHAIZE', 'COLRUYT', 'ALDI', 'LIDL', 'CARREFOUR EXPRESS', 'ALBERT HEIJN']), pick(CITIES), y, m, d) });
    if (random() < 0.08) add(CHECKING, iso(y, m, d), -between(45, 72), { description: card(pick(['Q8', 'TOTALENERGIES']), pick(CITIES), y, m, d) });
    if (random() < 0.08) add(CHECKING, iso(y, m, d), -between(9, 24), { description: card('NMBS/SNCB', pick(CITIES), y, m, d) });
    if (random() < 0.07) add(CHECKING, iso(y, m, d), -between(14, 38), { description: card(pick(['TAKEAWAY.COM', 'DELIVEROO']), pick(CITIES), y, m, d) });
    if (random() < 0.08) add(CHECKING, iso(y, m, d), -between(6, 42), { description: card(pick(['CAFE HET PLEIN', 'PIZZERIA NAPOLI', 'BAR CENTRAAL']), pick(CITIES), y, m, d) });
    if (random() < 0.05) add(CHECKING, iso(y, m, d), -between(15, 160), { description: card(pick(['BOL.COM', 'COOLBLUE', 'ZARA', 'ACTION', 'IKEA', 'BRICO PLANIT']), pick(CITIES), y, m, d) });
    if (random() < 0.04) add(CHECKING, iso(y, m, d), -between(4, 12), { description: card('PARKING CENTRUM', pick(CITIES), y, m, d) });
    if (random() < 0.03) add(CHECKING, iso(y, m, d), -between(8, 35), { description: card('APOTHEEK CENTRUM', pick(CITIES), y, m, d) });
  }

  // Occasional one-offs
  add(CHECKING, iso(y, m, 7), -5000, { description: `GELDOPNAME MET DEBETKAART BANCONTACT ${pick(CITIES)} ${be(y, m, 7)}` });
  add(CHECKING, iso(y, m, 14), -between(15, 45), { counterparty: pick(['Lotte Janssens', 'Pieter De Smet']), iban: 'BE00000000000606', description: `PAYCONIQ ${pick(['etentje', 'cinema', 'cadeau Sarah', 'concert tickets'])}` });
  if (i !== 1) add(CHECKING, iso(y, m, 20), between(12, 30), { counterparty: 'CM CHRISTELIJKE MUTUALITEIT', iban: 'BE00000000000707', description: 'TERUGBETALING GENEESKUNDIGE VERSTREKKINGEN' });
});

removeSampleData();

db.prepare('INSERT INTO sessions (id, bank, valid_until) VALUES (?, ?, ?)').run(
  SAMPLE_SESSION, 'Sample Bank', new Date(Date.now() + 180 * 86400_000).toISOString(),
);
const insertAccount = db.prepare(`
  INSERT INTO accounts (uid, session_id, bank, iban, name, currency, balance_cents, balance_date, last_synced)
  VALUES (?, ?, 'Sample Bank', ?, ?, 'EUR', ?, ?, ?)
`);
const insertTx = db.prepare(`
  INSERT INTO transactions (id, account_uid, booking_date, value_date, amount_cents, currency, counterparty, counterparty_iban, description, status, raw)
  VALUES (?, ?, ?, ?, ?, 'EUR', ?, ?, ?, 'BOOK', '{}')
`);

db.exec('BEGIN');
const syncedAt = new Date().toISOString();
const balances = { [CHECKING.uid]: 241375, [SAVINGS.uid]: 1250000 };
for (const account of [CHECKING, SAVINGS]) {
  insertAccount.run(account.uid, SAMPLE_SESSION, account.iban, account.name, balances[account.uid], today, syncedAt);
}
transactions
  .sort((a, b) => a.date.localeCompare(b.date))
  .forEach((t, i) => insertTx.run(`${t.account.uid}:${i}`, t.account.uid, t.date, t.date, t.cents, t.counterparty, t.iban, t.description));
db.exec('COMMIT');

const { matched, uncategorised } = applyRules();
console.log(`Created ${transactions.length} sample transactions (${MONTHS[0][0]}-${pad(MONTHS[0][1])} to ${today}) in 2 sample accounts.`);
console.log(`Rules categorised ${matched}; ${uncategorised} left for: npm run review`);
