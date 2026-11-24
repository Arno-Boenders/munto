// Pulls balances and transactions for every linked account into the local database.
// Safe to run as often as you like: transactions are de-duplicated.
import { createHash } from 'node:crypto';
import { getBalances, getTransactions } from './enablebanking.js';
import { db } from './db.js';
import { applyRules } from './categories.js';
import { linkWallets } from './wallets.js';
import { dropCsvOverlap } from './csvimport.js';
import { safe } from './terminal.js';

const INITIAL_DAYS = 365; // banks often allow only ~90 days of history; they'll return what they have
const OVERLAP_DAYS = 10;  // re-fetch recent days so pending transactions get updated once booked

const toCents = (amount) => Math.round(Number(amount) * 100);
const isoDate = (date) => date.toISOString().slice(0, 10);
// A date from the bank, kept only when it starts with a real YYYY-MM-DD date (as it came): anything else (a typo, "n/a") would
// otherwise end up as the start of every later sync and stop it.
const cleanDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && !Number.isNaN(Date.parse(d.slice(0, 10))) ? d : null);

const accounts = db
  .prepare(`
    SELECT a.*, s.valid_until FROM accounts a JOIN sessions s ON s.id = a.session_id
    WHERE a.uid NOT LIKE 'sample-%' AND a.uid NOT LIKE 'csv-%' -- imported from a CSV: no bank to ask
  `)
  .all();

if (accounts.length === 0) {
  console.log('No linked accounts yet. Run: npm run link -- "<bank name>"');
  process.exit(0);
}

const upsertTx = db.prepare(`
  INSERT INTO transactions
    (id, account_uid, booking_date, value_date, amount_cents, currency, counterparty, counterparty_iban, description, status, raw)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    booking_date = excluded.booking_date, status = excluded.status, raw = excluded.raw
`);
// Only booked (BOOK) transactions are final. Pending (PDNG) and scheduled ones (some banks
// return future standing orders as OTHR) are replaced on every sync, and must not move the
// sync start date forward, or real transactions in between would be skipped.
// Only within the days fetched again: older unbooked ones (PayPal keeps reversed payments as RJCT for good)
// wouldn't come back, and deleting them would leave their refund without the payment it undid.
const deleteUnbooked = db.prepare("DELETE FROM transactions WHERE account_uid = ? AND status IS NOT 'BOOK' AND booking_date >= ?");
// The newest booked date that is a real date and not in the future (a wrong date from the bank must not
// move the start of the next sync past today).
const lastBooking = db.prepare(
  "SELECT max(booking_date) AS d FROM transactions WHERE account_uid = ? AND status = 'BOOK' AND booking_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND substr(booking_date, 1, 10) <= ?",
);
const updateAccount = db.prepare(
  'UPDATE accounts SET balance_cents = ?, balance_date = ?, last_synced = ? WHERE uid = ?',
);

let failed = 0;
for (const account of accounts) {
  const label = safe(`${account.bank} ${account.iban ?? account.uid}`);
  // One bank's trouble (an outage, a malformed answer) doesn't stop the other accounts or the rules.
  try {
    if (new Date(account.valid_until) < new Date()) {
      console.log(`! ${label}: access expired on ${account.valid_until.slice(0, 10)}. Re-link with: npm run link -- "${account.bank}"`);
      continue;
    }

    const last = lastBooking.get(account.uid, isoDate(new Date())).d;
    const from = last ? new Date(last) : new Date(Date.now() - INITIAL_DAYS * 86400_000);
    if (last) from.setDate(from.getDate() - OVERLAP_DAYS);

    const transactions = await getTransactions(account.uid, isoDate(from));

    // Some banks don't return a stable transaction id. Fall back to a content hash, with an
    // occurrence counter so two identical payments on the same day are both kept.
    const seen = new Map();
    let skipped = 0;
    db.exec('BEGIN');
    try {
      // Unbooked transactions often get a new id once booked; drop old ones, the fresh fetch has them all.
      deleteUnbooked.run(account.uid, isoDate(from));
      for (const tx of transactions) {
        // Without an amount there is nothing to record: skip it rather than lose the whole account.
        if (!Number.isFinite(Number(tx?.transaction_amount?.amount))) { skipped++; continue; }
        const outgoing = tx.credit_debit_indicator === 'DBIT';
        const counterparty = outgoing ? tx.creditor : tx.debtor;
        const counterpartyAccount = outgoing ? tx.creditor_account : tx.debtor_account;
        const amountCents = toCents(tx.transaction_amount.amount) * (outgoing ? -1 : 1);
        const description = (tx.remittance_information ?? []).join(' ').trim() || null;
        const bookingDate = cleanDate(tx.booking_date) ?? cleanDate(tx.transaction_date) ?? cleanDate(tx.value_date);

        let id = tx.entry_reference || tx.transaction_id;
        if (!id) {
          const fingerprint = [account.uid, bookingDate, amountCents, counterparty?.name, description].join('|');
          const n = (seen.get(fingerprint) ?? 0) + 1;
          seen.set(fingerprint, n);
          id = 'h_' + createHash('sha256').update(`${fingerprint}|${n}`).digest('hex').slice(0, 32);
        }

        upsertTx.run(
          `${account.uid}:${id}`,
          account.uid,
          bookingDate,
          cleanDate(tx.value_date),
          amountCents,
          tx.transaction_amount.currency,
          counterparty?.name ?? null,
          counterpartyAccount?.iban ?? null,
          description,
          tx.status ?? null,
          JSON.stringify(tx),
        );
      }
      db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const balances = await getBalances(account.uid);
  // The balance your banking app shows: what's there now, with today's payments taken off ("interim
  // available", then "interim booked", "expected"). "Closing booked" is only last night's, so it comes last:
  // some banks send both, and closing booked misses that day's card payments.
  const balance =
    ['ITAV', 'ITBD', 'XPCD', 'CLBD'].map((type) => balances.find((b) => b.balance_type === type)).find(Boolean) ??
    balances[0];
  updateAccount.run(
    balance?.balance_amount ? toCents(balance.balance_amount.amount) : null,
    cleanDate(balance?.reference_date) ?? isoDate(new Date()),
    new Date().toISOString(),
    account.uid,
  );

  const balanceText = balance?.balance_amount ? safe(`${balance.balance_amount.amount} ${balance.balance_amount.currency}`) : 'n/a';
  console.log(`✓ ${label}: ${transactions.length} transactions since ${isoDate(from)}, balance ${balanceText}`);
  if (skipped) console.log(`! ${label}: skipped ${skipped} transactions without an amount`);
  } catch (err) {
    failed++;
    console.log(`! ${label}: ${safe(err.message)}`);
  }
}

const mirrored = linkWallets();
if (mirrored) console.log(`✓ ${mirrored} bank payments matched to their PayPal transaction (counted once, with the real merchant)`);
const covered = dropCsvOverlap();
if (covered) console.log(`✓ ${covered} imported CSV transactions now come from your bank instead (counted once)`);

const { uncategorised } = applyRules();
if (uncategorised > 0) console.log(`\n${uncategorised} transactions need a category: npm run review`);
// Still a failed sync for the app and the CLI, after everything that could be done was done.
if (failed) process.exitCode = 1;
