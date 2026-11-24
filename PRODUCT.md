# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One person managing their own money. Belgian, transactions are often in
Dutch or French. Checks in on a laptop browser and a phone browser equally: a quick "how am I doing
this month" glance, and a longer sit-down to categorise and review.

## Product Purpose
Show where the money goes (groceries, eating out, transport, …), what comes in (salary vs. money
that is paid back), and keep categorisation nearly effortless with rules plus AI suggestions.
Success: every euro has a category within a minute of syncing, and the month's picture is readable
at a glance.

## Positioning
Local-first: real bank data (PSD2 via Enable Banking) lives in a SQLite file on the user's own computer.
Nothing is sent anywhere except, on request, uncategorised merchant names/amounts to Claude (via the local Claude Code CLI).

## Operating Context
- `npm run sync` (or the Sync button) pulls transactions; rules in `config/categories.json`
  categorise them; the rest goes to Review.
- Bank consent expires every 90–180 days; re-linking happens in the terminal.
- UI is a Next.js app (React, App Router) served on 127.0.0.1 only; the CLI stays dependency-free.

## Capabilities and Constraints
- **Paid back:** incoming money in a spending category (family paying back rent/groceries, friends
  via Payconiq, health-insurance refunds) lowers that category's net spend, and is listed in its own
  "Paid back" view. Income = income categories only (salary).
- Transfers between own accounts are excluded from spending.
- **Where to cut:** found locally (subscriptions, price rises, creeping pots, frequent small
  payments, double charges, biggest wants); the AI only ranks and phrases them from names and amounts.
- **AI budget:** suggests a monthly budget per pot from the last 6 finished months; only monthly
  totals per pot (plus expected income and planned savings) are sent. The user edits and saves.
- **AI:** suggests a category for every uncategorised merchant; the user approves (accept all, or
  one by one). Nothing is saved without approval. Runs through the local `claude` CLI on the
  user's Claude subscription (no API key).
- Amounts in EUR, Belgian formatting (`€ 1.234,56`).

## Evidence on Hand
Your own bank transactions in `data/budget.db`. No merchant logos.

## Product Principles
1. The month at a glance first; detail one click away.
2. Net truth: paid-back money and own-account transfers never distort spending.
3. Categorising should feel like approving, not data entry.
4. Private by default; say plainly when data would leave the machine.

## Accessibility & Inclusion
Works with keyboard; never relies on color alone for in/out (signs and labels too).
