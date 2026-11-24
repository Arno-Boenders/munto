// Applies the rules in config/categories.json to all transactions (except ones you categorised
// by hand). Run it after editing the rules; `sync` and `review` also run it automatically.
import { applyRules } from './categories.js';
import { db } from './db.js';

const { matched, uncategorised } = applyRules();

const counts = db
  .prepare(`
    SELECT coalesce(category, '(uncategorised)') AS category, count(*) AS n
    FROM transactions GROUP BY 1 ORDER BY n DESC
  `)
  .all();
for (const { category, n } of counts) console.log(`${String(n).padStart(5)}  ${category}`);

console.log(`\n${matched} categorised by rules, ${uncategorised} still uncategorised.`);
if (uncategorised > 0) console.log('Categorise the rest with: npm run review   (add -- --ai for suggestions)');
