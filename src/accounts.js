// Quick overview of what's in the local database.
import { db } from './db.js';
import { safe } from './terminal.js';

const fmt = (cents, currency) => (cents == null ? 'n/a' : `${(cents / 100).toFixed(2)} ${currency ?? ''}`);

const accounts = db
  .prepare(`
    SELECT a.*, s.valid_until, (SELECT count(*) FROM transactions t WHERE t.account_uid = a.uid) AS tx_count
    FROM accounts a JOIN sessions s ON s.id = a.session_id ORDER BY a.bank
  `)
  .all();

for (const a of accounts) {
  console.log(safe(`${a.bank} ${a.iban ?? a.uid} ${a.name ?? ''}`));
  console.log(`  balance ${fmt(a.balance_cents, a.currency)}  |  ${a.tx_count} transactions  |  access until ${a.valid_until.slice(0, 10)}`);

  const recent = db
    .prepare('SELECT * FROM transactions WHERE account_uid = ? ORDER BY booking_date DESC LIMIT 5')
    .all(a.uid);
  for (const t of recent) {
    console.log(`    ${t.booking_date}  ${fmt(t.amount_cents, t.currency).padStart(14)}  ${safe(t.counterparty ?? t.description ?? '')}`);
  }
}
if (accounts.length === 0) console.log('No linked accounts yet. Run: npm run link -- "<bank name>"');
