# Roadmap

Ideas for where budget-app goes next. Nothing here is built yet. Each section says **why**, **what
it looks like**, **how it could work** with the code we have, and the **open questions** to settle
before building it.

**Where it is today:** a local-first app for one person. It syncs Belgian bank accounts through
Enable Banking into `data/budget.db`. Rules in `config/categories.json` sort transactions into
envelopes, and Claude (through the local `claude` CLI) suggests envelopes for whatever the rules
miss. The Next.js UI shows each month (payday to payday) as *Income − Spent − Saved = Left*, with
trends, a breakdown donut and a day calendar.

**Suggested order** (details in [Phasing](#phasing) at the end):

1. Income settings
2. Savings plan and projections
3. AI budget suggestion
4. AI "where could I cut" insights
5. Open source release (the cleanup can start in parallel, since several items above make it easier)
6. Desktop app: install it like any app, everything stays on your computer

---

## 1. Choose what counts as income

> **Status: built** (Income page). Spreading holiday pay over 12 months: dropped, not needed.

### Why
Right now income is whatever lands in the `incomeCategories` envelopes (just `Income`). The payday is
the biggest income payment on or after `paydayFromDay`. That works for one salary, but:
- a side income, a bonus, holiday pay (*vakantiegeld*) or a 13th month inflates one month and makes
  the comparisons noisy;
- money from family that is really income (not paid back) can't be marked as income;
- someone else using the app may have two salaries, freelance income or benefits.

### What it looks like
A new **Income** section on the Rules page (or its own *Settings → Income* page):

- **Income sources**: a list of the merchants/payers detected as income in the last 6 months, each
  with a toggle:
  - *Salary* (regular: it decides when the month starts)
  - *Other income* (counts as income, doesn't move the payday)
  - *Not income* (put it back in an envelope or in "paid back")
- **Payday rule**: "My month starts when *[payer]* pays me, on or after day *[20]*", or "Use calendar
  months". This replaces the hidden `paydayFromDay` config value with something visible.
- **Expected income** (optional): a fixed monthly amount, e.g. "I expect € 2.500 a month". Used for:
  - showing *Left* before the salary has landed ("based on your expected income");
  - budgets and projections, which need a steady number rather than a noisy one;
  - a small warning when the actual salary differs from the expectation ("€ 120 less than usual").
- **One-offs**: mark a single payment (bonus, holiday pay) as *one-off income*. It still counts as
  income for that month, but averages and the budget suggestion leave it out.

### How it could work
- Config grows a small `income` block in `config/categories.json`:
  ```json
  "income": {
    "sources": [{ "match": "acme", "kind": "salary" }, { "match": "freelance", "kind": "other" }],
    "paydayFromDay": 20,
    "expectedMonthlyCents": 250000
  }
  ```
  Keep reading `incomeCategories` / `paydayFromDay` for backward compatibility and migrate on first save.
- `budgetPeriods()` in `src/api.js` only uses `kind: "salary"` sources to find the payday.
- One-offs: a transaction-level flag. Easiest is a new `flags` column on `transactions` (e.g.
  `one-off`), so it survives re-running rules, just like `category_source = 'manual'`.
- The "detected income sources" list is a query: incoming money in income categories, plus any
  recurring incoming payer, grouped by merchant with count and average.

### Open questions
- Should "expected income" ever override actual income in *Left*, or only fill in until the salary
  lands? (Proposal: only fill in, and label it clearly.)
- Holiday pay in Belgium usually comes in May/June: offer a "spread over 12 months" option for
  averages?

---

## 2. Savings plan and "where will I be in X years"

> **Status: built** (Savings page, §a–d), including goals and *Left* after planned savings on the Overview.

### Why
Saved is already its own line in the ledger, but it's only looked at month by month. The
motivating view is the long one: "if I keep putting € 400 aside every month, where am I in 5
years?" A fixed savings amount also makes *Left* more honest, because the plan is already
subtracted.

### What it looks like
**a) A savings plan per savings envelope** (one per own account, as today):
- "I save **€ 300** a month into *Savings account*" and "**€ 100** a month into *Investments (ETF)*".
- Option: *Same every month* (fixed) or *Whatever is left* (variable; the projection then uses the
  average of the last 6 finished months).
- Optional start balance (taken from the account balance if that account is linked; otherwise
  typed in) and an expected yearly return (e.g. 2 % savings account, 6 % for an equity ETF, 0 % for cash).

**b) On the Overview:**
- The savings card shows plan vs actual: "€ 300 of € 300 planned ✓" or "€ 150 of € 300 · € 150 to go
  before payday". Use the same gauge style as the envelopes.
- In the ledger, *Left* can show "€ 400 left (after your planned savings)" while the transfer
  hasn't happened yet.
- A **running total**: "Saved since you started tracking: € 5.000" (sum of Saved across all periods).

**c) A new Trends view "Growth"** (next to Breakdown / In & out / …):
- A line chart with the **past** as a solid line (actual cumulative savings or real balances), and
  the **future** as a projected line from today.
- A horizon switch: **1 · 5 · 10 · 20 years**.
- A **band** for uncertainty on investment accounts, e.g. a pessimistic/expected/optimistic return
  of 3 / 6 / 8 %. It's a shaded area, never one exact number.
- Stacked by account, so you see the savings account vs the ETF grow separately.
- Hover/tap a year: "Oct 2031: € 31.400 (of which € 24.000 deposited, € 7.400 growth)".
- Optional toggle **"in today's money"** that corrects for inflation (default 2 %).
- **What if** sliders under the chart: monthly amount and return. Move them and the line updates
  live: "+€ 50 a month = € 3.400 more after 5 years".

**d) Goals (later):** "Emergency fund € 10.000", "Car € 8.000 by June 2028". The chart draws a
horizontal line per goal and says when you'd reach it at the current pace ("reached in March 2028,
3 months early"). If you're behind, it says how much more per month you'd need.

### How it could work
- Config: `savingsPlan` keyed by the same IBAN/name keys as `ownAccountNames`:
  ```json
  "savingsPlan": {
    "BE00 0000 0000 0000": { "monthlyCents": 30000, "mode": "fixed", "annualReturn": 0.02, "startCents": 500000 },
    "broker": { "mode": "average", "annualReturn": 0.06 }
  }
  ```
- Projection math (monthly compounding, all in cents, done in `lib/` so the CLI can use it too):
  ```
  r  = (1 + annualReturn)^(1/12) − 1
  FV = start·(1+r)^n + monthly·((1+r)^n − 1)/r     (if r = 0: start + monthly·n)
  ```
  Real value: divide by `(1 + inflation)^(n/12)`.
- **History**: we already know the net saved per period (`overview().savings`). The cumulative sum
  is the "deposited" line. If a savings account is linked, its `balance_cents` gives the real
  current value, and the difference between them is interest and growth.
- A new `GET /api/projection?years=10` returns the series, or compute it in the client, since it is
  pure math over the plan plus the history. Draw it with the same hand-rolled SVG as the other charts
  (`components/charts.jsx`), with `r2()` rounding.
- Fixed-plan check per period: compare `saved` per pot with `monthlyCents`; overview gets a
  `plan: { plannedCents, actualCents }` per savings envelope.

### Open questions
- Many people's savings accounts aren't linked (only the main account is). Ask for a balance once and
  then add deposits on top, or let people type a balance now and then?
- Belgian specifics worth a note in the UI: regulated savings accounts pay base interest plus a
  loyalty premium, and there's a yearly tax-free interest threshold. *Pensioensparen* is a yearly
  amount with its own tax benefit and could be a savings envelope with a yearly instead of a monthly
  plan.
- Wording: always say "projection, not a promise", and never show investment growth without the
  band.

---

## 3. AI-suggested budget from the last 6 months

> **Status: built** (Budget page, with the 50/30/20 check and a look-back at last month in the tips). Also built: **funds** (sinking funds), envelopes that keep what's left over. Each payday the budget goes in, what isn't spent stays, and a big month (a trip, the yearly gym) is paid from it instead of showing as over; the Overview's Left says what's free after the funds, and yearly subscriptions in a fund show whether it will hold enough by then. Also built: the **look back at last month** (raise, keep or lower per envelope, judged by the budget it had then, with a nudge on the Overview) and **budget history** (`budgetHistory`, each change counts from the month it was made).

### Why
The envelopes currently compare against a 3-month average, which describes what happened but isn't
a target. A budget gives every envelope a number to stay under. Setting 15 numbers by hand is a
chore, though, and that's exactly the "approving, not data entry" moment this app is good at.

### What it looks like
- A new **Budget** page (or a step on the Overview when no budget exists yet): *"Let Claude suggest a
  budget from your last 6 months"*.
- The result is a table, one row per envelope:

  | Envelope | 6-month avg | Range | Suggested | Why |
  |---|---|---|---|---|
  | Groceries | € 400 | € 350–450 | **€ 420** | Steady; small buffer for the higher months |
  | Eating out | € 200 | € 100–350 | **€ 180** | Swings a lot; the 3 highest months pull the average up |
  | Subscriptions | € 60 | € 55–65 | **€ 60** | Fixed costs; budget = what you pay |
  | Travel | € 100 | € 0–600 | **€ 100 / month** | One big trip; put aside monthly |

  Every number is editable. **Accept all**, or accept per row, the same pattern as the Unsorted page.
- A summary on top: "Budgeted spending € 2.150 + planned savings € 400 = € 2.550 of € 2.800 expected
  income → € 250 unplanned buffer". It warns when the budget plus savings is more than income.
- After that, **envelope cards show budget instead of average**: the gauge fills up to the budget,
  with "€ 84 left in Eating out, 9 days to payday". The pace line ("on track / € 40 ahead of
  budget") uses the budget too.
- Next month: "Your budget for Eating out was € 180, you spent € 205. Raise it, or keep it as a
  target?" A gentle monthly review, not a nag.

### How it could work
- **Compute the facts locally first**, so the AI only gets aggregates: for each envelope, the net spend
  per finished period for the last 6 periods, plus whether it's mostly fixed (low variance,
  recurring same merchant). One-off income and own transfers are already left out.
- **Send only aggregates** to Claude: envelope names and monthly totals, expected income and the
  savings plan. No merchant names, descriptions or IBANs. That's less than the categorisation
  already sends, and the UI should say so ("Only the monthly totals per envelope are sent").
- Reuse `src/suggest.js` (`claude -p`, no tools, the `SUGGEST_MODEL` setting) with a new prompt that
  asks for strict JSON:
  ```json
  { "budgets": [{ "category": "Eating out", "monthlyCents": 18000, "kind": "flexible", "reason": "…" }],
    "summary": "…" }
  ```
  Validate it: known categories only, amounts ≥ 0, fill in averages for anything missing.
- **No AI fallback**: a plain rule (median of the 6 months, rounded up to € 10; fixed costs = last
  amount) so the feature works without Claude. It's also a good sanity check on the AI's numbers.
- Storage: `budgets` in config (`{ "Groceries": 42000, … }`), or a table `budgets(category, from_period,
  cents)` if we want history ("budget changed in March"). Proposal: start in config, move to a table
  when history matters.
- Envelope kinds help both the AI and the UI: **fixed** (rent, insurance, subscriptions), **flexible**
  (groceries, eating out), **irregular/sinking** (travel, gifts, car maintenance: budget per year,
  shown per month).

### Open questions
- 6 months vs "everything you have": let the user choose, with 6 as the default.
- Should yearly costs (insurance, *verkeersbelasting*, holidays) be spread out as a monthly
  "sinking fund"? Done: any envelope can be made a fund (`funds` in the config), and irregular envelopes
  and ones with a yearly subscription are suggested.

---

## 4. "Where could I cut?" AI insights

> **Status: built** (Where to cut page, Overview panel, and a Subscriptions page you fill in yourself, with what's due before payday).

### Why
Seeing the numbers doesn't always make the leaks obvious: a forgotten subscription, delivery food
creeping up, the same thing paid twice. The app has every transaction, so it can point at them.

### What it looks like
An **Insights** panel on the Overview (and a full list on the Budget page), each insight a small card
with a number, a reason and actions:

- 🔁 **Subscriptions you might not use**: "You pay € 13,99/month to *Streaming X* and € 9,99 to
  *Streaming Y*: € 287 a year." Actions: *Keep* · *I'll cancel* (reminder) · *Not a subscription*.
- 📈 **Price increases**: "*Gym* went from € 30 to € 35 in August."
- 🍕 **Creeping envelopes**: "Eating out is up 40 % over 3 months, mostly *Delivery app* (10 orders, € 200)."
- 👯 **Possible duplicates**: "Two payments of € 49,00 to *Shop* on the same day."
- 💸 **Biggest wins**: the AI ranks the 3 changes with the most impact and phrases them concretely:
  "Cooking twice more a week instead of ordering would save about € 90 a month, which is 1,5 years
  sooner to your car goal." This ties the insight to the savings projection from section 2.
- Every insight shows **how much per year**, because yearly numbers make small leaks visible.
- Dismissed insights stay dismissed. *I'll cancel* comes back next month to check: "*Streaming Y* was
  charged again, still cancelling?"

### How it could work
- **Detection is local, deterministic code**; the AI adds judgement and phrasing on top. This keeps it
  cheap, private and testable:
  - *Recurring*: same merchant, similar amount (±10 %), roughly monthly/yearly interval, at least 3 times.
    Mark them as subscriptions. This is also useful for the budget (fixed costs) and for a future
    "upcoming bills before payday" list.
  - *Price change*: last amount of a recurring item vs the previous ones.
  - *Trend*: per envelope, last 3 finished periods vs the 3 before, and which merchants explain the
    difference.
  - *Frequency*: number of transactions per merchant per period (small but frequent spends).
  - *Duplicates*: same merchant + amount within 1–2 days.
- Then send the **list of findings** (merchant names and amounts, no descriptions or IBANs) plus the
  budget and goals to Claude, asking it to rank them, phrase them, estimate realistic savings, and
  skip anything that looks essential (rent, health, insurance). Strict JSON back, as with the budget.
- Storage: an `insights` table (`id, kind, key, payload, status: new|dismissed|cancelling, created_at`)
  so dismissals and "I'll cancel" follow-ups survive syncs. Recompute after each sync, and keep the
  status by `kind + key`.
- Tone matters (PRODUCT.md principle: approving, not nagging): at most 3 insights on the Overview,
  never shaming, always with the euro amount and a "this is fine, hide it" option.

### Open questions
- Run the AI part automatically after every sync, or only on a button press ("Find savings")?
  Proposal: detection runs every sync (free, local); the AI step runs on request or once a month.
- Should "subscriptions" get its own page? It's a popular feature in other apps (a list of all
  recurring payments, next charge date, yearly total).

---

## 5. Open source, so anyone can use it

### Why
This works well and isn't tied to one person, but today it assumes a developer who is comfortable with
`.env` files, certificates and the terminal. Making it public means separating *the product* from
*my data*, and making setup something a non-developer could do.

### 5a. Clean up before the repo goes public
- [x] **Initialise git** (done: a private GitHub repo) and check `.gitignore` covers `secrets/`,
      `.env`, `data/`, `.next/`, `.impeccable/` (local design-tool data) and the cert files.
- [x] **Personal config out of the repo** (done: ignored in git, copied from the example on first run): `config/categories.json` has my own rules, IBANs and account
      names. Ship `config/categories.example.json` with a generic set of envelopes and common Belgian
      merchant rules (Delhaize, Colruyt, NMBS, De Lijn, Proximus, Telenet, …), and copy it on first run.
      Ignore the real one in git.
- [x] **Scrub personal mentions in code and docs** (done): the comment in `src/api.js` that names my
      employer, the example name in `lib/format.js`, and the screenshots/HTML in `.impeccable/`.
      PRODUCT.md and DESIGN.md describe "the owner"; rewrite them for any user.
- [x] **Check the git history** before publishing (done: published with a fresh history) (start with a fresh history if anything personal was
      ever committed).
- [x] **Licence** (decided: PolyForm Noncommercial 1.0.0, so it can be used and changed freely but not sold;
      that makes it source-available rather than open source). Considered: MIT (simple, permissive) and
      AGPL-3.0 (keeps hosted forks open, but allows selling). The font is OFL; keep
      `app/fonts/OFL-familjen-grotesk.txt`.
- [x] `SECURITY.md` (done): the threat model (localhost only, the proxy checks, what the AI receives) and how
      to report issues.

### 5b. Make setup easy
The biggest hurdle: every user needs **their own Enable Banking application** (restricted mode is free
for your own accounts, but each person registers their own app and key). We can't hide that, but we
can guide it:
- [x] **A first-run setup wizard in the UI** (built: the setup guide at `/welcome`, opened by itself on a first
      start, with Welcome, Enable Banking, your bank, payday and income, AI and a summary; Settings links to it.
      Still to do: choosing your pots) instead of README steps:
  1. *Welcome*: what the app does, what stays local.
  2. *Enable Banking*: a step-by-step with screenshots, then paste the app ID, upload the `.pem` file
     (stored in `secrets/`), and the app checks it immediately.
  3. *Link your bank*: pick from the list (`npm run banks`, but in the UI), then approve in the
     bank app. Linking moves from the terminal into the UI, including the localhost callback and cert
     (or the manual paste-the-URL flow).
  4. *Payday & income* (section 1), *Envelopes* (start from the example set), *AI* (detect the
     `claude` CLI, explain what's sent, optional).
- [x] **Demo mode** (built): *Try with sample data* on the first screen and under Settings. The sample runs
      from three months back up to today, and linking your own bank removes it.
- [x] **CSV import** (built: Accounts → *Import a CSV*, `src/csvimport.js`. One importer for every bank instead
      of one per bank: it detects the separator, decimal comma and date format, guesses the columns from their
      Dutch, French or English names, shows a preview to correct them, and remembers them per file layout.
      It also fills in history from before a bank was linked) as a no-bank-API path: most Belgian banks export CSV (KBC, BNP Paribas Fortis,
      Belfius, ING, Argenta), each in its own column format. Write a small importer per bank. This also
      helps people outside Enable Banking's coverage, and is a good first contribution for others.
- [x] **PayPal** (built): link it like a bank (`npm run link -- "PayPal"`). PayPal names the real merchant
      where the bank only says "PayPal Europe"; each PayPal payment is matched to its bank payment and
      counted once (`src/wallets.js`). Subscriptions sort their own payments first, so a monthly
      storage plan from an app store is a subscription and the store's other payments can be Leisure. The same
      approach would work for other wallets (Revolut, Wise) that also show up at the bank.
- [ ] **One-command start**: `npx budget-app` or a Docker image
      (`docker run -p 127.0.0.1:4000:4000 -v ./data:/app/data …`). Node 22.13+ is required for
      `node:sqlite`, so Docker removes the "which Node do I have" problem.
- [x] **Scheduled sync** (built: `npm run schedule`, `src/schedule.js` and `src/scheduled.js`; the reminder
      also shows on the Overview, and the desktop app shares it through `src/reminders.js`)
      (launchd on macOS, systemd timer or cron on Linux, Task Scheduler on Windows)
      plus a reminder before bank consent expires. Already on the old ideas list.

### 5c. Make it work for more people
- [ ] **Languages**: the UI is English, transactions are Dutch/French. Add NL and FR UI translations
      (simple message files; most UI text lives in `components/`).
- [ ] **Other countries**: Enable Banking covers most of Europe (`EB_COUNTRY`). Make the country a
      setup choice; formatting already uses `Intl`, so make the locale/currency configurable instead of
      fixed `nl-BE` / EUR.
- [x] **AI provider choice** (built: Setup → Sorting with AI, `src/ai.js`; subscription CLIs other than Claude Code and the keychain still to do): people use different AI. Support the main ones, chosen in one setting, and
      keep everything working with AI off. See *AI providers* in §6 for the list and how it works.
- [x] **Windows** (built: points 1–7 and CI on Windows; still to do: try it on a real Windows PC, and point 8, a Node-only certificate for browser mode). Works already:
      the pages, database, data folder (`%APPDATA%\Munto`), backups, bank linking in the app window,
      the per-run secret, sync; and an app built locally gets no SmartScreen warning. To do:
      1. npm scripts use shell syntax (`NEXT_DIST_DIR=… next build`, `'test/*.test.js'`): small Node
         scripts instead, so `npm run ui`, `app` and `test` work in PowerShell/cmd.
      2. `npm run app:install` for Windows: electron-builder `--win`, install into the user's programs
         folder, Start menu shortcut (now macOS only: /Applications, codesign, osascript).
      3. Keep running in the system tray when the window closes (now Windows quits, stopping the sync).
      4. A coloured tray icon (`.ico`): the macOS template icon is black, invisible on a dark taskbar.
      5. `app.setAppUserModelId('app.envelopes')`, or notifications don't show.
      6. Start quietly at login with a `--hidden` argument (`wasOpenedAtLogin` is macOS only).
      7. Starting `claude` (often `claude.cmd` on Windows) and other AI CLIs: needs a shell or `.cmd` handling.
      8. Browser mode only: `make-cert.sh` and `open` in `npm run link` are Mac/Linux; use Node for both.
      Also: a Windows job in CI (tests + build on `windows-latest`), so these never break again.
- [ ] **Multiple people/households** (later): two partners with a shared account. Out of scope at
      first; note it so the data model doesn't block it.

### 5d. Project hygiene
- [x] **Tests** for the money logic that must never be wrong: payday periods, net spend with
      paid-back money, own-transfer detection, savings per pot, rule matching, projections, the
      50/30/20 trim and subscription matching. `npm test`, with Node's built-in `node:test`; each test
      file gets its own temporary database and config (`test/fixture.js`), so your data is never touched.
- [x] **CI** (GitHub Actions): tests + `next build` on every push and PR (`.github/workflows/ci.yml`).
- [x] `CONTRIBUTING.md` (built, with the architecture), issue templates ("my bank's CSV format", "rule
      suggestions", bugs) and a pull request checklist, all asking for made-up data only.
- [x] **README for strangers** (built; the details moved to `docs/guide.md`): screenshots (with sample data,
      never real data), a 30-second "what is this", a privacy section up front, then setup.
- [ ] **Versioning + changelog**, and DB migrations that are safe to run on every start (`src/db.js`
      already does this informally with `ALTER TABLE` checks; make it a numbered list).

### Open questions
- Repo name / product name? "budget-app" is generic. Something envelope-themed would fit the design.
- Is a hosted version ever a goal? (Proposal: no. Local-first is the point, and hosting bank data
  brings regulatory and security obligations.)

---

## 6. Desktop app: install it, and everything stays on your computer

> **Decided (Oct 2026):** Electron (it can grow into an app for other people and Windows without a rewrite;
> Tauri, a Swift wrapper and "Add to Dock" + launchd were considered). First version: **just me, on my
> Mac, desktop only.** Then other (technical) people install it **from source**, which needs no
> certificates; signed downloads only when it's for people who never open a terminal. See *Shipping it*
> below. Status: v1 built (Munto.app via `npm run app:install`, data folder, bank linking in the app,
> menu-bar icon, morning sync, notifications, backups). Next: stage 2.

### Why
Today you need a terminal, Node, `npm install`, a `.env` file and a self-signed certificate. A desktop app
turns that into "download, open, pick your bank". It also fits the product: local-first is easier to
trust when it's a real app on your computer, with your database in your own app folder.

### What it looks like
- A normal app (`Munto.app` / `.exe` / AppImage) with its own window, dock icon and menu.
- **First run:** a short setup: *Welcome* (what stays local) → *Connect your bank* → *Your payday and
  income* → *AI for sorting (optional)* → *First sync*. Or *Try with sample data* to look around first.
- **Syncs by itself:** when the app opens, and once a day while it runs (optionally from the menu bar /
  tray). A notification when new transactions need sorting, and a week before bank access expires
  ("Your bank's access ends on 12 March: renew now").
- **Everything local:** the database, rules and settings live in the system's app folder
  (`~/Library/Application Support/Munto/` on macOS, `%APPDATA%\Munto\` on Windows). Keys are
  stored in the system keychain, never in a plain file. Export/backup of the database from the menu.

### How it could work
**Shell: Electron.** The app needs Node on the user's machine (SQLite, the Enable Banking calls and
signing, the AI calls, Next.js). Electron includes Node, so the current code runs nearly unchanged:
- `next build` with `output: 'standalone'`; Electron's main process starts that server on a random free
  port on 127.0.0.1 and opens a window on it. `proxy.js` keeps refusing anything not from this app.
- `DB_PATH` and the config path point at `app.getPath('userData')`; on first run `config/categories.example.json`
  is copied there (already how `loadConfig()` works).
- The CLI scripts become functions the app calls (sync, link) instead of child processes.
- Tauri was considered: smaller downloads, but it can't run Node code without shipping a separate Node
  binary as a "sidecar", which brings back most of the size and adds complexity.

**First check (the spike):** does Electron's built-in Node include `node:sqlite` (Node 22.13+)? If not,
switch `src/db.js` to `better-sqlite3` (nearly the same API, but a native module that has to be rebuilt
for Electron with `electron-rebuild`). Everything else depends on this, so it comes first.

**Bank sync, the hard part.** Enable Banking needs an application ID and its private key to sign requests.
1. *Bring your own key* (start here): the setup screen walks people through creating a free Enable Banking
   application in restricted mode (own accounts only), with screenshots, then they upload the `.pem` file
   and paste the ID. The app checks it immediately. Fully local, but fiddly.
2. *One app registration, yours* (later): users just pick their bank. The private key can never ship
   inside the app (anyone could extract it), so a tiny server would only hand out short-lived signed tokens.
   The app then calls Enable Banking directly with that token, so **bank data never passes through the
   server**. This needs a commercial agreement with Enable Banking (restricted mode is only for your own
   accounts), a privacy policy, and someone keeping that server running.
3. *CSV import* as the always-available fallback for banks or people without an API connection.

**The bank login redirect.** Today it goes to `https://localhost:3443/callback` with a self-signed
certificate. In the app: register a custom link (`envelopes://callback`) with the OS, or, if Enable
Banking only accepts https redirect URLs, a static https page that forwards to the app's link. The browser
certificate warning goes away either way.

**AI providers.** Today everything runs through Claude Code (`claude -p`) on my subscription. Other people
use other AI, so one setting, *AI provider*, with these options:
- **Claude Code** (today): the CLI on a Claude subscription, no key.
- **Claude API**: an Anthropic API key, stored in the keychain; a few cents a month at this volume.
- **ChatGPT / OpenAI API**: an OpenAI API key.
- **Gemini / Google AI API**: a Gemini API key (Google's free tier may be enough for this volume).
- **Subscription CLIs, like Claude Code** (if they work headless with structured output; check when building):
  OpenAI's Codex CLI on a ChatGPT subscription, and Google's Gemini CLI on a Google account. Same idea as
  `claude -p`: no key, uses what people already pay for.
- **Local model through Ollama** (later): nothing leaves the machine.
- **Off**: rules and manual sorting still do everything.

How it could work:
- **One interface, several adapters.** Today `src/suggest.js` builds the prompts and `runClaude()` sends them
  and expects JSON matching a schema. Split that: the prompts and the checking of answers stay shared, and a
  small adapter per provider sends one request and returns the parsed JSON. Each provider has its own way to
  force structured output (Claude's JSON schema / tool use, OpenAI's `response_format: json_schema`, Gemini's
  `responseSchema`, Ollama's `format`), so the adapter maps the same schema onto it. The existing checks
  (known categories only, amounts ≥ 0, …) stay in one place, so a weaker model can't save nonsense.
- **Settings:** provider, model (a sensible default per provider, e.g. the current small/fast model), and the
  key. Keys live in the macOS keychain (Electron `safeStorage`), never in `.env` or the data folder, and are
  only sent to that provider. A **Test** button sends a tiny request and says whether it works.
- **Privacy stays the same for every provider:** compute locally, send the minimum (merchant names and
  amounts for sorting, monthly totals for the budget), say in the UI which provider receives it, and never
  save anything without approval. The setting shows plainly where the data goes ("sent to OpenAI").
- **Quality:** the prompts are tuned on Claude. Keep a small set of example inputs (anonymised, in `test/`)
  and check each adapter returns valid answers for them; models differ, the checks catch it.
- **Cost:** sorting and tips are a few requests a week. Show the provider's rough cost per month, and
  never retry in a loop.
The less AI people need, the better: ship a good starter set of Belgian merchant rules (supermarkets, NMBS,
De Lijn, Proximus, Telenet, energy, insurers, …), and every accepted suggestion keeps becoming a rule, so
AI is mostly needed in the first week.

**Shipping it, in three stages.**
1. *Just me:* the app built from source on my Mac (`npm run app:install` builds Munto.app into
   Applications). Unsigned is fine: macOS only blocks apps that were *downloaded* (the browser marks them),
   not apps built on the computer itself. Updating = pull and run the same command.
2. *Other technical people, from source:* the repo goes public; they `git clone`, `npm install`,
   `npm run app:install` once (needs Node 22+ and a terminal, once), then it's the full app: setup screens,
   background sync, notifications, tray. Updates: the app checks GitHub for a newer version tag and offers
   an **Update** button that pulls, reinstalls dependencies, rebuilds and restarts (database backed up and
   migrated first; on failure the old version keeps running). Same on Windows: locally built apps get no
   SmartScreen warning. No certificates, no costs.
3. *Everyone (later, optional):* signed, notarized downloads with normal auto-updates (below).

**Signed downloads (stage 3).**
- macOS: Apple Developer Program ($99/year) for a Developer ID certificate, plus notarization (Apple scans
  each build automatically, usually in minutes; electron-builder does both). Without it, macOS blocks a
  downloaded app (System Settings → Privacy & Security → Open Anyway; the right-click → Open trick is gone),
  and **auto-updates don't work at all for unsigned Mac apps** (Squirrel.Mac refuses them).
- Windows: unsigned works but shows the SmartScreen warning. A certificate is roughly €200–500/year (now on
  a hardware key or in the cloud), or Azure Trusted Signing (~$10/month; check it's open to individuals in
  Belgium when we get there). Linux needs no signing.
- Updates: `electron-updater` with GitHub Releases as the feed (needs the repo public, or a separate public
  releases repo): CI builds on a version tag and uploads the installers plus `latest-mac.yml`; the app
  checks on open and daily, downloads in the background, and offers *Restart to update*.
- Certificates and passwords live in GitHub Actions secrets, never in the repo.

**Shipping it to other people (details).**
- Installers with `electron-builder`: `.dmg` (macOS, Apple Silicon and Intel), `.exe` (Windows), AppImage/`.deb` (Linux).
- Code signing: Apple Developer Program ($99/year) for notarization, otherwise macOS warns that the app
  may be unsafe; a code-signing certificate for Windows (or the warnings for a while).
- Auto-updates (`electron-updater`, from GitHub Releases), with a changelog shown after an update.
- Database migrations that run safely on every start (see §5d), and a backup before each migration.
- Optional: encrypt the database with a password (SQLCipher), for shared or work computers.

### Steps
1. **Spike** (an hour or two): the current app inside an Electron window, database included. Settles
   `node:sqlite` vs `better-sqlite3`.
   v1 for my own Mac also needs: the data folder (`~/Library/Application Support/Munto/`, shared with
   `npm run ui`), bank linking inside the app window (catch the redirect, no local https server or
   certificate), sync on open and every morning (start hidden at login with a menu-bar icon),
   notifications (to sort, access expiring), and finding `claude` when launched from Finder (apps don't
   get the terminal's PATH).
2. **My own Mac:** a packaged app with the data folder, sync on open and a daily sync, unsigned, for daily use.
3. **First-run setup:** bank linking in the app (bring your own key), the custom-link callback, AI provider
   choice with the API key in the keychain, sample data mode.
4. **Background sync and notifications:** tray icon, "N to sort", consent-expiry reminders.
5. **For other people:** signed installers for macOS and Windows, auto-updates, CSV import, starter rules.
6. **Later:** the hosted token server for one-click bank linking, Ollama, database encryption.

### Open questions
- Name and icon: renamed from "Envelopes" to Munto (Dutch *munt*, coin) in October 2026, after a
  look-alike envelope app turned up in the App Store. Still to check: trademarks (BOIP, EUIPO) and a domain.
- Keep the web version (`npm run ui`) alongside the desktop app? Proposal: yes, same code; the desktop app
  is a wrapper around it.
- Phone: the desktop app can't serve the phone browser the way `npm run ui` can over a VPN. A phone
  version would be a separate project (or a read-only export).
- Is Enable Banking's commercial tier affordable for a free app, or does one-click linking stay out of scope?

---

## Smaller ideas worth keeping
- **Upcoming bills before payday**: from the recurring detection: "Still to come: rent € 800 (1st),
  internet € 40 (3rd)". Then *Left* can say "€ 400 left, € 100 of it already spoken for".
- **Envelope rollover**: unspent budget moves to next month (or into savings).
- **Split a transaction** across envelopes (one supermarket receipt = groceries + household).
- **Notes and tags** on a transaction ("birthday present", "#holiday-italy"), with tag totals.
- **Year in review**: a yearly page in December/at the last payday: total in, out, saved, top
  merchants, biggest change.
- **Export** to CSV / a monthly PDF summary.
- **PWA**: add to the phone's home screen, open fullscreen. Needs care, because the server only
  listens on 127.0.0.1 (a phone reaches it only via Tailscale or similar; document that, don't open
  the port).
- **Net worth**: all linked balances over time (we already store `balance_cents` per sync; keep a
  history table instead of overwriting).

---

## Phasing

| Phase | What | Why this order |
|---|---|---|
| **1** | Income settings (§1), savings plan + Growth chart (§2a–c) | Small and self-contained, and they give budgets and projections a stable income and savings number to build on. |
| **2** | Budget, rule-based first, then AI (§3) | Needs §1's expected income; reuses the Unsorted "accept" pattern and `src/suggest.js`. |
| **3** | Local detection → Insights → AI ranking (§4), Upcoming bills | The recurring detection feeds budgets (fixed costs) and bills; the AI layer comes last. |
| **4** | Open-source cleanup (§5a), tests, CI | Can start anytime. Doing it before §5b avoids building a setup wizard on personal config. |
| **5** | Setup wizard, demo mode, CSV import, Docker, languages (§5b–c) | Makes it usable for people who aren't me. |
| **6** | Desktop app (§6): spike, own Mac, first-run setup, background sync, signed installers | Builds on §5's setup wizard and CSV import; the spike can run any time to de-risk it. |
| Later | Goals (§2d), rollover, splits, net worth, households | Nice to have once the foundations exist. |

**Privacy rule for every AI feature** (from PRODUCT.md, principle 4): compute locally, send the
minimum (aggregates where possible), say in the UI exactly what is sent, never save anything
without approval, and keep the feature working without AI.
