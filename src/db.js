import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { dbPath, privateDir, privateFile } from './paths.js';

// Under `node --test` (NODE_TEST_CONTEXT is set), never fall back to your real database: a test that imports
// this before test/fixture.js has set DB_PATH would otherwise write into it.
if (process.env.NODE_TEST_CONTEXT && !process.env.DB_PATH) throw new Error('Tests must set DB_PATH (import test/fixture.js and await setup() first)');
// One connection per process (Next.js dev reloads modules; reuse it instead of opening another). The path is
// only worked out when opening, so a reload never moves the database out from under an open connection.
function open() {
  const path = dbPath(); // the app's data folder (see paths.js), or DB_PATH
  privateDir(dirname(path));
  const db = new DatabaseSync(path);
  privateFile(path);
  return db;
}
export const db = (globalThis.__budgetDb ??= open());
// Several processes can open it at once (the build's workers, a sync while the app runs): wait for a lock
// instead of failing with "database is locked".
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    bank         TEXT NOT NULL,
    valid_until  TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    uid          TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES sessions(id),
    bank         TEXT NOT NULL,
    iban         TEXT,
    name         TEXT,
    currency     TEXT,
    balance_cents INTEGER,
    balance_date TEXT,
    last_synced  TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id            TEXT PRIMARY KEY,           -- bank id, or a content hash if the bank gives none
    account_uid   TEXT NOT NULL REFERENCES accounts(uid),
    booking_date  TEXT,
    value_date    TEXT,
    amount_cents  INTEGER NOT NULL,           -- negative = money out
    currency      TEXT NOT NULL,
    counterparty  TEXT,
    counterparty_iban TEXT,
    description   TEXT,
    status        TEXT,                       -- BOOK (booked) or PDNG (pending)
    category      TEXT,
    category_source TEXT,                     -- 'rule' (re-applied when rules change) or 'manual' (kept)
    raw           TEXT NOT NULL               -- full JSON from the API, in case you need more fields
  );

  CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_uid, booking_date);

  -- What you did with a "where could I cut" tip: kept (it's worth it), hidden, or cancelling (since "at").
  CREATE TABLE IF NOT EXISTS insight_status (
    id      TEXT PRIMARY KEY,
    status  TEXT NOT NULL,
    at      TEXT NOT NULL
  );
`);

// Databases created before categorisation existed lack this column.
const txColumns = db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name);
// Another process may add the same column at the same moment (the build's workers): that's fine.
const addColumn = (name, type) => {
  if (txColumns.includes(name)) return;
  try { db.exec(`ALTER TABLE transactions ADD COLUMN ${name} ${type}`); } catch (err) { if (!/duplicate column/i.test(err.message)) throw err; }
};
addColumn('category_source', 'TEXT');
// One-off income (a bonus, holiday pay): still income that month, but left out of averages and paydays.
addColumn('one_off', 'INTEGER NOT NULL DEFAULT 0');
// A bank payment that only moved money into a wallet (PayPal): the wallet transaction it mirrors (see wallets.js).
addColumn('mirror_of', 'TEXT');
