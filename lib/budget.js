// Budget maths shared by the Budget page and the tests. Money is integer cents.
import { fmtMoney } from './format.js';

const whole = (cents) => fmtMoney(Math.round(cents / 100) * 100).replace(/,00$/, '');

// The suggestion without AI: your own numbers (latest amount for fixed costs, median for flexible ones,
// average for irregular ones), then each group trimmed to its share of income under the rule. Fixed costs
// stay as they are; the rest of the group is scaled down evenly, and never raised above what you spend.
export function fitToRule(data, groups, rule) {
  const shares = { needs: data.rules[rule][0], wants: data.rules[rule][1] };
  const out = {};
  for (const g of ['needs', 'wants']) {
    const es = data.pots.filter((e) => groups[e.category] === g);
    const target = data.income * shares[g];
    const fixed = es.filter((e) => e.kind === 'fixed').reduce((t, e) => t + e.plain, 0);
    const flex = es.filter((e) => e.kind !== 'fixed').reduce((t, e) => t + e.plain, 0);
    const f = flex > 0 ? Math.min(1, Math.max(0, (target - fixed) / flex)) : 1;
    const pct = Math.round(shares[g] * 100);
    for (const e of es) {
      if (e.kind === 'fixed' || f === 1 || e.plain === 0) {
        out[e.category] = { cents: e.plain, reason: e.kind === 'fixed' ? 'fixed cost' : null };
      } else {
        const cents = Math.floor((e.plain * f) / 500) * 500;
        out[e.category] = { cents, reason: `from ${whole(e.plain)}, −${Math.round((1 - f) * 100)}% to fit` };
      }
    }
  }
  return out;
}
