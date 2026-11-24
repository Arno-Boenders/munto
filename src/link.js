// Links a bank: you approve access in your bank app / itsme, the bank redirects your browser
// to the local HTTPS callback, and we exchange the code for a session with account access.
//
//   npm run link -- "KBC"            local callback server catches the redirect
//   npm run link -- "KBC" --manual   paste the redirected URL yourself (no local server)
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { listBanks, startAuth, createSession } from './enablebanking.js';
import { saveSession } from './linking.js';
import { enableBanking } from './settings.js';
import { safe } from './terminal.js';

const args = process.argv.slice(2);
const manual = args.includes('--manual');
const bankQuery = args.find((a) => !a.startsWith('--'));
const { country, redirectUrl } = enableBanking();

if (!bankQuery) {
  console.error('Usage: npm run link -- "<bank name>" [--manual]   (see `npm run banks`)');
  process.exit(1);
}

const banks = await listBanks(country);
const bank =
  banks.find((b) => b.name.toLowerCase() === bankQuery.toLowerCase()) ??
  banks.find((b) => b.name.toLowerCase().includes(bankQuery.toLowerCase()));
if (!bank) {
  console.error(`No bank matching "${bankQuery}" in ${country}. Run \`npm run banks\` for the list.`);
  process.exit(1);
}

// Ask for the longest consent the bank allows (PSD2 caps it, typically 90-180 days).
const maxSeconds = bank.maximum_consent_validity ?? 90 * 86400;
const validUntil = new Date(Date.now() + maxSeconds * 1000);
const state = randomUUID();

const { url } = await startAuth({ bank: bank.name, country, redirectUrl, state, validUntil });

console.log(`\nLinking ${safe(bank.name)} (access valid until ${validUntil.toISOString().slice(0, 10)})`);
console.log(`Approve access in your browser:\n\n  ${safe(url)}\n`);
// Open the bank's login page in your browser, only if it's an https address, and never through a shell:
// open (macOS), Windows' own URL handler (no cmd.exe), xdg-open (Linux). Anything else is only printed.
const safeToOpen = (raw) => { try { return new URL(raw).protocol === 'https:'; } catch { return false; } };
if (!safeToOpen(url)) console.error('That isn’t an https address, so it wasn’t opened. Open it yourself only if you trust it.');
else if (process.platform === 'win32') execFile('rundll32.exe', ['url.dll,FileProtocolHandler', new URL(url).href], () => {});
else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [new URL(url).href], () => {});

const code = manual ? await codeFromPastedUrl() : await codeFromCallbackServer();
const session = await createSession(code);

// Saves it; renewing moves your existing accounts (same IBAN) to the new ids, with their transactions.
let saved;
try {
  saved = saveSession(session, bank.name, validUntil.toISOString());
} catch (err) {
  console.log(`\n! ${safe(err.message)}`);
  process.exit(1);
}
for (const a of saved.accounts) console.log(`  ${a.renewed ? 'renewed' : 'linked'} ${safe(`${a.iban ?? a.uid} ${a.name ?? ''}`)}`);
console.log(`\nDone. Pull transactions with: npm run sync`);

function extractCode(callbackUrl) {
  const params = new URL(callbackUrl).searchParams;
  if (params.get('error')) throw new Error(`Bank returned an error: ${params.get('error')} ${params.get('error_description') ?? ''}`);
  if (params.get('state') !== state) throw new Error('State mismatch: this redirect is not from the authorization we started');
  const code = params.get('code');
  if (!code) throw new Error('No ?code= in the redirect URL');
  return code;
}

async function codeFromPastedUrl() {
  console.log('After approving, your browser ends up on the redirect URL (it may show an error page; that is fine).');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = await rl.question('Paste the full URL from the address bar: ');
  rl.close();
  return extractCode(pasted.trim());
}

function codeFromCallbackServer() {
  const { hostname, port, pathname } = new URL(redirectUrl);
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error(`EB_REDIRECT_URL is not localhost (${hostname}); use --manual instead`);
  }
  let tls;
  try {
    tls = { key: readFileSync('secrets/localhost-key.pem'), cert: readFileSync('secrets/localhost-cert.pem') };
  } catch {
    throw new Error('No local certificate found. Run `npm run cert` first (or use --manual).');
  }

  return new Promise((resolve, reject) => {
    const server = createServer(tls, (req, res) => {
      const reqUrl = new URL(req.url, redirectUrl);
      if (reqUrl.pathname !== pathname) {
        res.writeHead(404).end();
        return;
      }
      try {
        const code = extractCode(reqUrl.href);
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>Bank linked</h1><p>You can close this tab.</p>');
        resolve(code);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end(err.message);
        reject(err);
      }
      server.close();
    });
    server.listen(Number(port) || 443, hostname, () =>
      console.log(`Waiting for the bank to redirect to ${redirectUrl} ...`),
    );
  });
}
