// Wallets (PayPal): a payment through PayPal shows up twice, once in PayPal with the real merchant
// ("Streamly AB") and once at your bank as "PayPal Europe". The PayPal side is what you spent; the bank side
// only moved the money there. After every sync, each PayPal transaction is matched to its bank payment
// (same amount, within a week), and the bank side becomes a mirror: in the transfer pot, but never
// counted as spending or as saving (`category_source = 'mirror'`, `mirror_of` = the PayPal transaction).
// PayPal payments in another currency get the euro amount the bank took. Bank payments without a match
// (from before PayPal's history starts) stay as they are.
import { db } from './db.js';
import { loadConfig } from './categories.js';

export const WALLET_BANKS = /paypal/i;
const PAYER = /paypal/i; // who the bank says the payment is to or from (the counterparty, not free text)
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// wallet: [{ id, date, cents, currency }], bank: [{ id, date, cents }] (all in EUR).
// Returns [{ wallet, bank, cents }]: cents is the euro amount, also for a foreign-currency payment.
export function matchWallet(wallet, bank) {
  const free = new Set(bank.map((b) => b.id));
  const pairs = [];
  const closest = (w, ok) => bank
    .filter((b) => free.has(b.id) && Math.sign(b.cents) === Math.sign(w.cents) && days(w.date, b.date) >= -2 && days(w.date, b.date) <= 7 && ok(b))
    .sort((a, b) => Math.abs(days(w.date, a.date)) - Math.abs(days(w.date, b.date)))[0];
  // Euros first: the same amount.
  for (const w of wallet.filter((x) => x.currency === 'EUR')) {
    const b = closest(w, (x) => x.cents === w.cents);
    if (b) { free.delete(b.id); pairs.push({ wallet: w.id, bank: b.id, cents: b.cents }); }
  }
  // Then other currencies: what's left, at a believable exchange rate.
  for (const w of wallet.filter((x) => x.currency !== 'EUR')) {
    const b = closest(w, (x) => x.cents / w.cents >= 0.6 && x.cents / w.cents <= 1.25);
    if (b) { free.delete(b.id); pairs.push({ wallet: w.id, bank: b.id, cents: b.cents, rate: b.cents / w.cents }); }
  }
  return pairs;
}

// Runs the matching on the database. Returns how many pairs were found this time.
export function linkWallets() {
  const { transferCategory } = loadConfig();
  if (!transferCategory) return 0;
  // A mirror whose PayPal transaction is gone (PayPal stopped returning it) counts again, sorted by the rules.
  db.prepare(`UPDATE transactions SET category = NULL, category_source = NULL, mirror_of = NULL
              WHERE mirror_of IS NOT NULL AND mirror_of NOT IN (SELECT id FROM transactions)`).run();
  const walletUids = db.prepare('SELECT uid, bank FROM accounts').all().filter((a) => WALLET_BANKS.test(a.bank)).map((a) => a.uid);
  if (!walletUids.length) return 0;
  const inList = walletUids.map(() => '?').join(',');
  const linked = new Set(db.prepare('SELECT mirror_of FROM transactions WHERE mirror_of IS NOT NULL').all().map((r) => r.mirror_of));
  const wallet = db.prepare(`SELECT id, booking_date AS date, amount_cents AS cents, currency FROM transactions WHERE account_uid IN (${inList})`)
    .all(...walletUids).filter((t) => !linked.has(t.id));
  if (!wallet.length) return 0;
  const from = wallet.reduce((d, t) => (t.date < d ? t.date : d), wallet[0].date);
  const bank = db.prepare(`SELECT id, booking_date AS date, amount_cents AS cents, counterparty, description FROM transactions
                           WHERE account_uid NOT IN (${inList}) AND mirror_of IS NULL AND booking_date >= date(?, '-3 days')`)
    .all(...walletUids, from).filter((t) => PAYER.test(t.counterparty ?? ''));
  const pairs = matchWallet(wallet, bank);
  const mirror = db.prepare("UPDATE transactions SET category = ?, category_source = 'mirror', mirror_of = ? WHERE id = ?");
  const toEuro = db.prepare("UPDATE transactions SET amount_cents = ?, currency = 'EUR' WHERE id = ?");
  db.exec('BEGIN');
  try {
    for (const p of pairs) {
      mirror.run(transferCategory, p.wallet, p.bank);
      if (p.rate) toEuro.run(p.cents, p.wallet);
    }
    // A foreign payment without a bank match (paid from the PayPal balance): the usual rate, once at least
    // 3 matched payments show what it is. The original amount stays in the raw JSON (transaction_amount).
    const rates = pairs.filter((p) => p.rate).map((p) => p.rate).sort((a, b) => a - b);
    const rate = rates.length >= 3 ? rates[Math.floor(rates.length / 2)] : null;
    if (rate) {
      const matched = new Set(pairs.map((p) => p.wallet));
      for (const w of wallet) if (w.currency !== 'EUR' && !matched.has(w.id)) toEuro.run(Math.round(w.cents * rate), w.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return pairs.length;
}
