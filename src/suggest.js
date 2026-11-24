// Optional AI: suggests a category for each merchant that no rule matched (npm run review -- --ai and the
// Unsorted page), a budget, and a ranking of the tips. The prompts and the checks on the answers live here;
// which AI answers is chosen in ai.js. Only merchant names, amounts and descriptions of uncategorised
// transactions (or monthly totals) are sent, to that provider; nothing else leaves your machine.
import { aiConfigured, aiMissingMessage, runModel } from './ai.js';

const SYSTEM = `You categorise Belgian bank transactions for a personal budgeting app.
Descriptions are often in Dutch or French (e.g. "BETALING MET DEBETKAART" = card payment,
"OVERSCHRIJVING" = transfer, "DOMICILIERING" = direct debit). Payconiq transfers to a
person's name are usually paying friends back. For each merchant, pick the single best
category from the allowed list. Use "Other" only when nothing fits.

Money coming IN (positive amounts, or direction "in") from a person, a friend or a family member, or a refund from a
shop or health insurer (mutualiteit/ziekenfonds), is almost always someone paying back a shared or
refunded expense. Pick the category of that expense (Groceries, Housing, Eating out, Health, ...),
never the income category. Income is only salary, wages and benefits.

Also give a reason of at most 8 words, in English, that a person can check at a glance
(e.g. "Belgian supermarket chain", "Pays you back via Payconiq").`;

// Turns merchant groups ({ key, txs }) into the compact input the model sees. Without amounts (a choice
// under Settings) it only learns whether money went in or out.
export const suggestionInput = (groups, { amounts = true } = {}) =>
  groups.map(({ key, txs }) => ({
    key,
    examples: txs.slice(0, 3).map((t) => ({
      date: t.booking_date,
      ...(amounts ? { amount: (t.amount_cents / 100).toFixed(2) } : { direction: t.amount_cents < 0 ? 'out' : 'in' }),
      counterparty: t.counterparty,
      description: t.description,
    })),
  }));

// The AI itself (Claude Code, the Claude API, OpenAI, Gemini or Ollama) is chosen in ai.js.
export { aiConfigured, aiName, aiMissingMessage } from './ai.js';

// groups: [{ key, examples: [{ date, amount, counterparty, description }] }]
// Returns Map<key, { category, reason }>.
export async function suggestCategories(groups, categories) {
  if (groups.length === 0) return new Map();
  if (!aiConfigured()) throw new Error(aiMissingMessage());

  const schema = {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            category: { type: 'string', enum: categories },
            reason: { type: 'string' },
          },
          required: ['key', 'category', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  };

  const { suggestions = [] } = await runModel(
    `Allowed categories: ${categories.join(', ')}\n\nMerchants:\n${JSON.stringify(groups, null, 2)}`,
    { system: SYSTEM, schema },
  );
  return new Map(suggestions
    .filter((s) => categories.includes(s.category))
    .map((s) => [s.key, { category: s.category, reason: s.reason }]));
}

// ---------- budget ----------

const BUDGET_SYSTEM = `You help one person in Belgium set a realistic monthly budget per spending pot.
You get, per pot, the net spend (after money paid back) of each of the last finished months, oldest
first, and how the app classified it: fixed (the same every month: rent, insurance, subscriptions),
flexible (varies: groceries, eating out) or irregular (big now and then: travel, gifts, car).
Also the expected monthly income and the planned monthly savings.

For each pot suggest a monthly budget in whole euros:
- fixed: what it costs now (the latest typical amount), no buffer.
- flexible: close to the median, with a small buffer; if recent months crept up, say so and aim
  a little lower than the peak, but stay achievable.
- irregular: the average over the months, so it can be put aside monthly for the big ones.
- a pot with almost nothing: a small round amount or 0.
Each pot is a need or a want, and the person follows a budgeting rule: a share of income for needs,
for wants and for savings (e.g. 50/30/20). Aim the needs total and the wants total at their shares of
income. Make the total of budgets plus planned savings fit within the expected income when possible. When
something has to give, trim wants first (flexible ones before irregular ones), then flexible needs; never
cut fixed costs below what they cost. If savings are below their share, mention it. Say in the summary
how the needs and wants totals compare with their targets.
Give each a reason of at most 12 words in English, and a summary of at most 2 sentences.`;

// pots: [{ category, kind, months: [euros...] }]; returns { budgets: [{ category, euros, reason }], summary }
export async function suggestBudget({ pots, incomeEuros, savingsEuros, rule }) {
  if (!aiConfigured()) throw new Error(aiMissingMessage());
  const categories = pots.map((e) => e.category);
  const schema = {
    type: 'object',
    properties: {
      budgets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: categories },
            euros: { type: 'integer', minimum: 0 },
            reason: { type: 'string' },
          },
          required: ['category', 'euros', 'reason'],
          additionalProperties: false,
        },
      },
      summary: { type: 'string' },
    },
    required: ['budgets', 'summary'],
    additionalProperties: false,
  };
  const pct = (x) => `${Math.round(x * 100)}%`;
  const target = (x) => Math.round(incomeEuros * x);
  const prompt = `Expected income a month: €${incomeEuros}\nPlanned savings a month: €${savingsEuros}\n`
    + `Rule: needs ${pct(rule.needs)} (€${target(rule.needs)}), wants ${pct(rule.wants)} (€${target(rule.wants)}), savings ${pct(rule.savings)} (€${target(rule.savings)})\n\n`
    + `Pots:\n${JSON.stringify(pots, null, 2)}`;
  const result = await runModel(prompt, { system: BUDGET_SYSTEM, schema });
  return {
    budgets: (result.budgets ?? []).filter((b) => categories.includes(b.category) && Number.isFinite(b.euros) && b.euros >= 0),
    summary: String(result.summary ?? ''),
  };
}

// ---------- where could I cut ----------

const CUT_SYSTEM = `You help one person in Belgium find realistic ways to spend less. You get findings the app
detected in their own transactions (subscriptions, price rises, pots that crept up, small frequent
payments, possible double charges, their biggest wants), each with a yearly figure.

Rank them by what is most worth doing: big yearly impact, easy to act on, and not essential. Skip anything
that looks like a necessity (rent, insurance, health, groceries basics) unless it really stands out, and say
nothing judgemental. For each kept finding write a short title (at most 7 words) and one concrete tip of at
most 22 words, in plain friendly English, with a realistic monthly saving in whole euros (0 if it is
just worth checking, e.g. a possible double charge). Also a summary of at most 2 sentences.`;

export async function rankInsights({ incomeEuros, rule, findings }) {
  if (!aiConfigured()) throw new Error(aiMissingMessage());
  const ids = findings.map((f) => f.id);
  const schema = {
    type: 'object',
    properties: {
      ranked: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: ids },
            title: { type: 'string' },
            tip: { type: 'string' },
            monthlyEuros: { type: 'integer', minimum: 0 },
          },
          required: ['id', 'title', 'tip', 'monthlyEuros'],
          additionalProperties: false,
        },
      },
      summary: { type: 'string' },
    },
    required: ['ranked', 'summary'],
    additionalProperties: false,
  };
  const prompt = `Income a month: €${incomeEuros}. Budget rule: ${rule.replace(/-/g, '/')} (needs/wants/savings).\n\nFindings:\n${JSON.stringify(findings, null, 2)}`;
  const result = await runModel(prompt, { system: CUT_SYSTEM, schema });
  return {
    ranked: (result.ranked ?? []).filter((r) => ids.includes(r.id)).map((r) => ({ ...r, monthlyEuros: Math.max(0, Math.round(Number(r.monthlyEuros) || 0)) })),
    summary: String(result.summary ?? ''),
  };
}
