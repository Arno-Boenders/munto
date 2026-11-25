# Using Munto, in detail

The [README](../README.md) is the short version. This page covers every part of Munto: the pages, how sorting
and months work, the command line, the desktop app and where your data lives.

- [How it reaches your bank](#how-it-reaches-your-bank)
- [Setting up Enable Banking by hand](#setting-up-enable-banking-by-hand)
- [The pages](#the-pages)
- [Sorting: rules, Unsorted and AI](#sorting-rules-unsorted-and-ai)
- [Months, income and savings](#months-income-and-savings)
- [PayPal](#paypal)
- [Importing a CSV](#importing-a-csv)
- [Syncing every day](#syncing-every-day)
- [The command line](#the-command-line)
- [The desktop app](#the-desktop-app)
- [Your data folder](#your-data-folder)
- [The database](#the-database)

## How it reaches your bank

```
your bank ──PSD2 API──▶ Enable Banking ──REST──▶ Munto (localhost) ──▶ budget.db (your data folder)
```

Enable Banking is the licensed go-between: individuals can't call the banks' PSD2 APIs directly. Your data
only passes through it, read-only, and everything is stored on your computer. You register an application of
your own with Enable Banking; its free *restricted mode* covers your own accounts.

## Setting up Enable Banking by hand

The setup guide (it opens on a first start, and from **Settings → Open the setup guide**) walks you through
this and checks your application ID and key file with Enable Banking before saving them in your data folder,
readable only by you. You can also do it by hand with a `.env` file; values there take priority.

1. **Create an Enable Banking account** at https://enablebanking.com → Control Panel.
2. **Register an application** under *API applications*:
   - Environment: **Production**. The sandbox only has fake banks.
   - Allowed redirect URL: `https://localhost:3443/callback`
   - Download the generated **private key** and save it as `secrets/enablebanking.pem`.
3. **Activate restricted mode** (the free tier for your own accounts). Link your own accounts to the
   application in the control panel, as it prompts you to. Only those accounts can be read.
4. Configure Munto:
   ```sh
   cp .env.example .env    # then fill in EB_APP_ID (and EB_COUNTRY if your banks aren't Belgian)
   npm run cert            # a self-signed certificate for the https://localhost callback
   ```

**About the localhost callback (browser only):** after you approve access, the bank sends your browser to
`https://localhost:3443/callback`. Your browser warns that the certificate is self-signed; that's expected,
because you made it yourself. If you'd rather skip the local server, or Enable Banking won't accept a
localhost address, register any https address and run `npm run link -- "Your bank" --manual`, then paste
the address from the address bar after the redirect, even if the page shows an error. The desktop app
doesn't need any of this: it catches the redirect itself.

**Access expires.** PSD2 consent lasts 90–180 days, depending on the bank. From a week before, the Overview
says so (and the scheduled sync or the desktop app notifies you). Renew it on the Accounts page, or run
`npm run link` again; your accounts and their transactions stay.

## The pages

Every category is a *pot*: a jar that fills as you spend. It works on a laptop and in a phone browser.

- **Overview:** the month as one line, *Income − Spent − Saved = Left*. Each pot shows what it spent against
  your usual (the 3-month average) or its budget. What needs you sits above the pots: transactions to sort,
  bank access that's about to end, and last month's look-back.
- **Transactions:** grouped by day; filter by month, pot, in or out, or search. Change a pot inline and turn
  it into a rule with one click (*Always for …*).
- **Unsorted:** everything no rule caught, one merchant at a time. Pick a pot and it becomes a rule, so next
  month sorts itself. With an AI chosen under Settings, every merchant gets a suggested pot with a short
  reason; check them and **Accept all**. Keys: `j`/`k` move between merchants, `Enter` saves.
- **Budget:** a monthly limit per pot. Each row shows the last 6 months and this month as small bars, what's
  typical, and a suggestion: from your own numbers (the latest amount for fixed costs, the median for
  flexible ones, the average for irregular ones), or from the AI with a reason. Once set, the pots count
  down from their budget.
  - **Needs, wants, savings** checks you against a budgeting rule (50/30/20, 60/20/20 or 70/20/10): every pot
    is a *need* or a *want*, and the page says per group how far over or under its share you are, which pots
    cause it, and what cut would close the gap.
  - **Funds** (sinking funds): a pot that keeps what's left over. Each payday its budget goes in, what isn't
    spent stays, and a big month (a trip, a yearly bill) is paid from it instead of showing as over.
  - **Looking back:** once a month is over, it's judged by the budgets it had then. A pot that went over in
    most months gets *Raise to €X*; one that never used 70% of its budget gets *Lower to €X*.
- **Trends:** the spending pace against last month, a breakdown of the month, and charts over 6 or 12 months:
  in and out, per pot, saved and left, and a calendar of what you spent each day. **Money in** separates
  income from money **paid back** (a refund, a friend paying you back), which lowers the pot it was for.
- **Where to cut:** tips from your last 12 months: subscriptions, price rises, pots that crept up, small
  payments that add up, possible double charges. Each has a yearly figure. Mark one *It's worth it*, *Hide*,
  or *I'll cancel it* (Munto then tells you if it's charged again). The AI can rank them.
- **Subscriptions:** what you pay for, linked to its payments by a bit of text in them: the total a month and
  a year, what's still due before payday, and a flag for a price change or one that stopped.
- **Income:** who pays you (salary, other income, not income), one-off payments, when your month starts, and
  the income you expect.
- **Savings:** a plan per savings account, its expected return, and a **Growth** chart of where the plan takes
  you in 1–20 years, with a likely range and a *what if I saved more* slider. **Goals** (an emergency fund, a
  car) show when your plan gets you there.
- **Accounts:** balances and how long bank access lasts, with **Connect a bank**, **Renew access**,
  **Import a CSV** and **Sync now**.
- **Rules:** your pots, rules and own IBANs, to change by hand.
- **Settings:** Enable Banking, your bank, AI, income, which pages show, sample data and updates.

Trends, Where to cut, Savings and Rules can be switched off under Settings → Features.

The server only listens on `127.0.0.1`, so other devices on your network can't reach it. `PORT=5000 npm run ui`
picks another port.

## Sorting: rules, Unsorted and AI

`categories.json` (in your data folder) holds your pots and a list of rules. Each rule is a case-insensitive
pattern checked against the counterparty and description, for example `delhaize|colruyt|aldi` → Groceries.
The first rule that matches wins. Every sync applies the rules, so after the first round of sorting, new
transactions mostly sort themselves. On a first start, the file is copied from
`config/categories.example.json`, with common Belgian merchants already in.

Manual choices are never overwritten by rules. **Transfers between your own accounts** aren't spending:
linked accounts are recognised automatically, and other IBANs you mark as yours are kept in `ownIbans`.

**AI (optional)** suggests a pot for what your rules don't sort, a budget, and a ranking of the tips. It's off
until you choose one under **Settings → Sorting with AI**: Claude Code (on your Claude subscription, no key),
the Claude API, OpenAI, Google Gemini, Perplexity (each with an API key), or a local model through Ollama
(nothing leaves your computer). Only merchant names and amounts (or monthly totals) are sent, never IBANs or
balances, and every answer is checked before you see it. You approve everything. See `src/ai.js`.

## Months, income and savings

**Months run from payday to payday.** "November" starts the day your November salary lands (the biggest
payment from a *salary* payer on or after a day you choose) and ends the day before the next one. Income,
spending and savings all follow these months. Change it on the **Income** page, or switch to calendar months.

On the Income page, mark each payer as *Salary* (starts your month), *Other income*, or *Not income* (back
into a pot as paid back, like family chipping in for rent). Mark a bonus or holiday pay as a *one-off*: it
counts that month but not in your usual income. An optional *expected income* fills in what's left before
your salary lands.

**Saved** is what moved to your own savings or investment accounts that month (minus what came back). It
isn't spending, so pots ignore it, but the line subtracts it: Income − Spent − Saved = Left.

## PayPal

Link PayPal like a bank. PayPal's transactions name the real merchant where the bank only says "PayPal
Europe". Every PayPal payment also shows up at your bank, so after each sync the two are matched (same
amount, within a week) and the bank's side is marked *counted in PayPal*: still listed, never counted twice.
See `src/wallets.js`.

## Importing a CSV

For a bank Enable Banking doesn't cover, or history from before you linked your bank (banks usually share
about 90 days): export your transactions as CSV in your bank's app or website, then use **Import a CSV** on
the Accounts page.

It works with any bank's export. Munto detects the separator, the decimal comma and the date format, guesses
the columns from their names (Dutch, French or English), and shows a preview where you can correct each one
before anything is saved. Your choice is remembered for that kind of file. Importing a newer export later
only adds what's new.

When the same account (by IBAN) is also linked through Enable Banking, the bank's own transactions take over
from the first day it has, so a CSV can fill in the months before that without anything counted twice.
Imported accounts are never synced and have no access to renew; *Remove* takes one out again.

## Syncing every day

The desktop app syncs by itself (see below). For `npm run ui`, `npm run schedule` has your computer sync every
day at 07:30, or when it wakes up after that: launchd on macOS, a systemd user timer on Linux, Task Scheduler
on Windows. It backs up your data first, notifies you of new transactions, and from a week before a bank's
access ends, reminds you to renew it. What it did goes in `sync.log` in your data folder.

```sh
npm run schedule                  # set it up (again after moving the project or changing Node)
npm run schedule -- --status      # is it set up?
npm run schedule -- --off         # remove it
```

## The command line

Everything the pages do with your bank also works from a terminal. The command-line tools need nothing but
Node 22.13 or newer: they use Node's built-in `node:sqlite`, `fetch` and `node:crypto`.

```sh
npm run banks                 # the banks Enable Banking has for your country, with their exact names
npm run link -- "Your bank"   # opens your bank's login; approve in the bank's app
npm run sync                  # fetch balances and transactions into your data folder
npm run accounts              # a quick look at what's stored
npm run categorise            # apply the rules again
npm run review                # sort what's left, one merchant at a time (add -- --ai for suggestions)
npm run report                # spending per pot per month
npm run seed                  # sample data, the last 3 months (npm run seed -- --remove takes it out)
```

`npm run sync` is safe to run as often as you like: transactions are de-duplicated.

## The desktop app

**Download** it from the [Releases](https://github.com/Arno-Boenders/munto/releases) page, or build it on your
own computer with `npm run app:install` (see the README). Built from source, it's a small launcher that runs
Munto from your project folder, so your `.env`, keys and code stay there: after `git pull`, run
`npm run app:install` again, or use **Update** under Settings. While working on the code, `npm run app` starts
it straight from source.

What it does by itself:
- **Syncs** when it opens (unless it did in the last half hour) and **every morning** from 07:00, or as soon
  as the computer wakes up after that. Closing the window keeps it running in the menu bar or tray.
- **Menu-bar icon:** when it last synced, how many to sort, *Sync now*, *Open at login* (starts quietly, no
  window), *Back up your data* and *Show data folder*.
- **Notifications:** new transactions after the morning sync, a failed sync, from a week before a bank's
  access ends, and when a new version is out. A downloaded copy can't update itself: it opens the new version's
  page on GitHub, and you install it over the old one (your data stays where it is). Built from source,
  **Update** does it for you.
- **Backups** in `backups/` in your data folder: one before the first sync of each day and one before each
  update (the last 14 are kept), plus the ones you make from the menu (kept).
- **Claude Code** is found the way your terminal finds it, even when Munto is opened from the Dock.

## Your data folder

Everything that's yours lives in one folder, shared by `npm run ui`, the command line and the desktop app:
`budget.db` (all transactions, accounts and decisions), `categories.json` (pots, rules, budgets,
subscriptions, funds) and `settings.json` (Enable Banking and AI), with your Enable Banking key next to them.

| | |
|---|---|
| macOS | `~/Library/Application Support/Munto` |
| Windows | `%APPDATA%\Munto` |
| Linux | `~/.local/share/munto` (or `$XDG_DATA_HOME/munto`) |

Set `MUNTO_DATA_DIR` to use another folder. Back it up by copying the folder. Munto used to be called
Envelopes: an `…/Envelopes` folder is copied into the Munto folder once, the first time Munto starts.

## The database

| table          | what                                                             |
|----------------|------------------------------------------------------------------|
| `sessions`     | each bank authorisation and when it expires                      |
| `accounts`     | your accounts (IBAN, name, latest balance)                       |
| `transactions` | amount in cents (negative = spent), counterparty, description, status (`BOOK` = booked; pending ones are refreshed every sync), `category` and `category_source` (`rule` or `manual`), and the bank's own data as JSON |

Open it with `sqlite3` or any SQLite app (TablePlus, DB Browser for SQLite).
