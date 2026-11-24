# Security

Munto handles bank data, so here is plainly what stays on your computer, what leaves it, and how the
app protects itself, including what it doesn't do.

## What stays on your computer

- **All your data**: transactions, accounts, pots, rules, budgets and settings live in one folder
  (`~/Library/Application Support/Munto` on macOS, `%APPDATA%\Munto` on Windows,
  `~/.local/share/munto` on Linux): `budget.db` (SQLite) and `categories.json`. The folder is readable
  only by your account (700, files 600). Backups go in `backups/` inside it, just as private.
- **Your Enable Banking key** (`enablebanking.pem` in your data folder when set up on the Settings page, or
  `secrets/` with `.env`) is never sent anywhere; it only signs requests to Enable Banking.
- **AI API keys** (if you use the Claude API, OpenAI, Gemini or Perplexity) are saved in `settings.json` in your data
  folder (600) and only ever sent to that provider. The app's pages only see their last 4 characters.
- There is no Munto server, account or telemetry. Nothing is uploaded.

## What leaves your computer

- **To your bank, through Enable Banking** (PSD2, read-only): you approve access at your bank for at most
  90 to 180 days. Munto asks for balances and transactions, and can't make payments.
- **To the AI you choose, only once you've chosen one** (it's off until then, even if Claude Code is installed) (sorting suggestions, a suggested budget, ranking
  tips): Claude Code on your own subscription, the Claude API (Anthropic), the OpenAI API, the Google Gemini
  API, the Perplexity API (which passes it on to the maker of the model you pick, and doesn't search the web with it), or a local model through Ollama (then nothing leaves your computer). Or none. The Settings page says
  where your data goes. It receives:
  - for sorting: the names, amounts and descriptions of transactions that have no pot yet;
  - for a budget: monthly totals per pot, your expected income and savings plan;
  - for tips: merchant or pot names with amounts.

  Never IBANs or balances. Nothing the AI suggests is saved until you approve it, and everything works
  with AI off.

## How the app protects itself

- **The server only listens on 127.0.0.1** and refuses requests addressed to any other host name, which
  stops DNS-rebinding attacks from websites (`proxy.js`).
- **Websites can't use it:** requests a browser marks as coming from another site are refused, and changes
  must come from the app's own origin as JSON.
- **The desktop app adds a secret per run:** it runs all the time on a port every account on the computer
  can reach, so it makes a random secret when it starts. Its window and background sync send it; without
  it, nothing is answered.
- **The app window is locked down:** context isolation, sandbox, no Node in the page. Only the app's own
  pages load in it; other links open in your browser, and only `http`/`https` links. Bank logins open in a
  separate window that only loads `https` pages; the redirect back is caught before it loads.
- **Bank links expire** after 15 minutes if not finished, and are tied to a random state value.
- **Tests never touch your data:** they run on a temporary database and config, and refuse to start
  without them.

## Known limits

- **`npm run ui` has no per-run secret.** It's for working on the code. While it runs, another account on
  the same computer could reach it on 127.0.0.1:4000. On a computer you share, use the desktop app.
  (It runs Next.js behind the same checks as the app, with Next's dev tools that could open a debugger
  switched off: `scripts/dev-server.mjs`.)
- **The database isn't encrypted** by Munto. It relies on your account's file permissions and on disk
  encryption (FileVault on macOS, BitLocker on Windows); turn that on.
- **The desktop app is built on your own computer and signed only for it** (no Apple or Microsoft
  signature). That's why you build it yourself from this repository.
- **Updates aren't signed.** The Update button only pulls from a GitHub repository over https (the one this
  copy follows), with git's riskier options off, and never over changes of your own; but it trusts that
  repository. Releases signed with a key the app checks are on the roadmap.
- **Keys are files** (the Enable Banking key and AI API keys, readable only by you) for now; moving them to
  the system keychain is on the roadmap.

## Reporting a problem

Please report security problems privately through GitHub: on this repository, open **Security → Report a
vulnerability**. Don't open a public issue for them. You'll get an answer as soon as I can.
