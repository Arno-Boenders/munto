// The sample data (`npm run seed`, or *Try with sample data*) lives in its own session, so it can always be
// told apart from your own and removed in one go. Removal goes by that session, not by the "sample-" in the
// account ids: those come from your bank for real accounts, and must never decide what gets deleted.
import { db } from './db.js';

export const SAMPLE_SESSION = 'sample-session';

export function removeSampleData() {
  db.prepare('DELETE FROM transactions WHERE account_uid IN (SELECT uid FROM accounts WHERE session_id = ?)').run(SAMPLE_SESSION);
  db.prepare('DELETE FROM accounts WHERE session_id = ?').run(SAMPLE_SESSION);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(SAMPLE_SESSION);
}

// Sample data is only for before your own bank is in: afterwards it would mix with your real money.
export const hasOwnBank = () => db.prepare('SELECT count(*) AS n FROM accounts WHERE session_id != ?').get(SAMPLE_SESSION).n > 0;
