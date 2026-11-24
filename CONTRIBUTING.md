# Contributing to Munto

Thanks for helping. Munto is a small, local-first budgeting app, and contributions of every size are welcome:
a bug report, a bank's CSV format, a rule for a common merchant, a fix, or a feature.

## The one rule: never share real financial data

Munto handles bank data. Issues, pull requests, comments and commits are public and can't be fully taken
back, so **nothing from anyone's real money goes in them**: no real amounts or balances, merchant or payee
names from your own statements, IBANs, account names, transaction counts, or screenshots of your own data.

- Use the sample data instead (**Try with sample data** in the app, or `npm run seed`): three months of made-up
  transactions, made for exactly this.
- When an example helps, make one up: €12.34, "Bakery", `BE00 0000 0000 0000`, `example.com`.
- Test fixtures follow the same rule. Every test builds its own made-up world (see `test/fixture.js`).

If you've already posted something private, tell us and we'll help remove it.

## Running it

You need [Node](https://nodejs.org) 22.13 or newer and git. No bank or Enable Banking account is needed.

```sh
git clone https://github.com/Arno-Boenders/munto.git
cd munto
npm install
MUNTO_DATA_DIR=./dev-data npm run ui     # http://localhost:4000, with its own data folder
```

`MUNTO_DATA_DIR` keeps your development data apart from a real Munto on the same computer (`dev-data/` is
ignored by git). In PowerShell, set it first: `$env:MUNTO_DATA_DIR = 'dev-data'; npm run ui`. On the first
start, choose **Try with sample data**. `npm run app` starts the desktop app from
source (macOS, Windows and Linux).

## How it fits together

```
app/          the pages: Next.js server components that read through src/api.js
  api/        one JSON route for everything the buttons and forms change (→ src/api.js)
components/   the interactive parts (client components); charts are plain SVG in charts.jsx
src/          the data layer and command-line tools: node:sqlite, Enable Banking, rules, sync,
              CSV import, AI providers. Runs in Next.js and as plain Node (sync, seed, the scheduled sync)
lib/          small shared helpers without side effects (formatting, money maths, the request gate)
electron/     the desktop app: a window, the menu-bar icon, the morning sync, updates
scripts/      npm script helpers: the dev server, building and installing the desktop app
proxy.js      checks every request: only from this computer, and changes only from Munto's own pages
test/         node:test, one file per area
```

Some things to know before changing code:

- **This is a newer Next.js than you may know.** Before using a Next.js API, read its guide in
  `node_modules/next/dist/docs/` (see `AGENTS.md`).
- **`src/` runs in two places:** inside Next.js, and as plain Node in a child process (`npm run sync`, the
  desktop app's sync, the scheduled sync). Paths come from `src/paths.js`, never from the current directory.
- **Windows, macOS and Linux** all run it, and CI tests on Ubuntu and Windows: build paths with `join`, and
  write npm scripts in Node (`scripts/run.mjs`), not shell syntax.
- **Privacy is a feature.** Nothing about anyone's money leaves the computer except to their bank and the AI
  they chose (`src/ai.js`), and the interface says exactly what's sent. A new network call needs a good
  reason and a note in [SECURITY.md](SECURITY.md).

## Tests

```sh
npm test                 # all of them
npm run build            # the production build, as CI runs it
```

Tests use Node's built-in `node:test`. Each file starts with `await setup({ today, config, txs })` from
`test/fixture.js`: its own temporary database and config, and a fixed "today", so your data is never
touched. Money logic (months, budgets, savings, sorting, imports) gets a test with every change.

## Style

- **Words:** the interface says *pot*, never *envelope* or *category*. Text is short and plain, in sentence
  case, and only says what changes what you'd do (see *Writing* in [DESIGN.md](DESIGN.md)).
- **Amounts** always go through the `Money` component, so they line up and get the right sign.
- **Design:** [DESIGN.md](DESIGN.md) is the design system (colours, type, the jar, layout), and
  [PRODUCT.md](PRODUCT.md) has the product's principles.
- **Comments** say why, not what the next line does.

## Pull requests

- Open an issue first for anything big, so we can agree on the approach.
- One change per pull request, on a branch from `main`. Pull requests are squash-merged.
- Commit subjects are plain sentences about what someone using Munto gets, like *"The account balance is
  what's there now, not last night's closing balance"*, not `feat(scope): …`.
- Say in the pull request how you checked it: the tests, the build, and what you tried in the app (with
  sample data).

## Good first contributions

- **Your bank's CSV export isn't read right?** The column names Munto recognises are in `GUESS` in
  `src/csvimport.js`. Adding your bank's names is a one-line change, with a test in `test/csvimport.test.js`
  using a made-up row.
- **Rules for common merchants:** `config/categories.example.json` is what new users start with. Public
  businesses only (supermarket chains, transport, utilities), never people.
- **Trying it on Windows or Linux**, and reporting what doesn't work.

## Making a release (maintainers)

Set `"version"` in `package.json` in a pull request, merge it, then tag `main` and push the tag
(`git tag v0.4.0 && git push origin v0.4.0`). The *Release* workflow builds the downloads on macOS, Windows
and Linux into a draft release, to check and publish by hand. `npm run dist` builds the ones for your own
computer into `dist/`.

## Security

Please don't open a public issue for a security problem: report it privately (**Security → Report a
vulnerability** on GitHub). See [SECURITY.md](SECURITY.md).

## Licence

Munto is under the [PolyForm Noncommercial License 1.0.0](LICENSE): free for any noncommercial use, not for
selling. By contributing, you agree that your contribution is released under the same licence, and that Arno
Boenders, who maintains Munto, may also release it under other licences, for example a more open one later.
