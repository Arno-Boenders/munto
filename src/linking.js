// Linking a bank from the app or the web UI (and `npm run link`): start an authorisation at Enable Banking,
// the bank sends you back to EB_REDIRECT_URL with a code, and that code becomes a session with accounts.
//   In the desktop app, the bank's login opens in an app window and the app catches the redirect itself.
//   In a browser, a short-lived https server on the redirect address catches it (with the self-signed
//   certificate from `npm run cert`), or you paste the address you landed on.
// Renewing gives the same accounts new ids; the old account (same IBAN, or for PayPal the same name) moves
// to the new id with its transactions, so nothing is downloaded twice.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.js';
import { normIban } from './categories.js';
import { PROJECT } from './paths.js';
import { removeSampleData } from './sample.js';
import { enableBanking, isConfigured } from './settings.js';

const TTL = 15 * 60_000; // an authorisation has to be finished within 15 minutes
const pending = (globalThis.__muntoLinks ??= new Map()); // state -> { bank, validUntil, at, status, result, error }
const country = () => enableBanking().country;
const eb = () => import('./enablebanking.js');

export class LinkError extends Error {}

export async function banks() {
  const { listBanks } = await eb();
  return (await listBanks(country()))
    .map((b) => ({ name: b.name, days: Math.floor((b.maximum_consent_validity ?? 90 * 86400) / 86400), beta: !!b.beta }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const isHttps = (raw) => { try { return new URL(raw).protocol === 'https:'; } catch { return false; } };
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Starts an authorisation. `browser`: also listen on the redirect address, for a browser tab.
export async function startLink(bankName, { browser = false } = {}) {
  const { redirectUrl } = enableBanking();
  if (!isConfigured()) throw new LinkError('Enable Banking isn’t set up yet: do that on the Settings page first');
  const { listBanks, startAuth } = await eb();
  const bank = (await listBanks(country())).find((b) => b.name === bankName);
  if (!bank) throw new LinkError(`${bankName} isn't in the list of banks for ${country()}`);
  // The longest access the bank allows (PSD2 caps it, typically 90-180 days).
  const validUntil = new Date(Date.now() + (bank.maximum_consent_validity ?? 90 * 86400) * 1000);
  const state = randomUUID();
  const { url } = await startAuth({ bank: bank.name, country: country(), redirectUrl, state, validUntil });
  // The page opens this address: only ever a real https page, never javascript: or another scheme.
  if (!isHttps(url)) throw new LinkError('Enable Banking sent an unexpected address for the bank page; try again');
  for (const [s, p] of pending) if (Date.now() - p.at > TTL) pending.delete(s);
  pending.set(state, { bank: bank.name, validUntil: validUntil.toISOString(), at: Date.now(), status: 'waiting' });
  if (browser) listenForRedirect(redirectUrl);
  return { url, state, redirectUrl, validUntil: validUntil.toISOString() };
}

// The code and state from the address the bank sent you back to (or its error, e.g. you cancelled).
export function fromCallback(address) {
  let url;
  try { url = new URL(String(address ?? '').trim()); } catch { throw new LinkError('That doesn’t look like the address the bank sent you to'); }
  const p = url.searchParams;
  if (p.get('error')) throw new LinkError(p.get('error_description') || `The bank said: ${p.get('error')}`);
  if (!p.get('code') || !p.get('state')) throw new LinkError('That address has no code in it: copy the whole address from the address bar');
  return { code: p.get('code'), state: p.get('state') };
}

export async function finishLink({ code, state }, create) {
  const p = pending.get(state);
  if (!p || Date.now() - p.at > TTL) throw new LinkError('This link has expired or wasn’t started here. Start again.');
  if (p.status === 'done') return p.result;
  try {
    const session = await (create ?? (await eb()).createSession)(code);
    p.result = saveSession(session, p.bank, p.validUntil);
    p.status = 'done';
    return p.result;
  } catch (err) {
    p.status = 'error';
    p.error = err.message;
    throw err;
  }
}

export function failLink(state, message) {
  const p = pending.get(state);
  if (p && p.status === 'waiting') Object.assign(p, { status: 'error', error: message });
}

export function linkStatus(state) {
  const p = pending.get(state);
  if (!p) return { status: 'unknown' };
  return { status: p.status, bank: p.bank, error: p.error ?? null, accounts: p.result?.accounts ?? null };
}

// Saves a session and its accounts. An account you had before under another id (renewing access) moves to
// the new id, with its transactions and the PayPal links that point at them.
export function saveSession(session, bankName, validUntil) {
  const accounts = session.accounts ?? [];
  // In restricted mode Enable Banking only shares accounts that are also linked to the application in its
  // control panel: the bank approves access, but no accounts come back.
  if (!accounts.length) {
    throw new LinkError(`${bankName} approved access but shared no accounts. In restricted mode, first link this account to your application in the Enable Banking control panel (enablebanking.com/cp), then try again.`);
  }
  // "csv-" and "sample-" ids are Munto's own (imported accounts, the sample data): a bank's session or account
  // never gets one, or removing the sample data or an import could take your bank's data with it.
  const reserved = (id) => !String(id ?? '').trim() || /^(csv|sample)-/i.test(String(id));
  if (reserved(session.session_id) || accounts.some((a) => reserved(a.uid))) throw new LinkError(`${bankName} sent an id Munto can't use, so nothing was saved. Try connecting again.`);
  const findOld = db.prepare(`
    SELECT uid FROM accounts WHERE uid != ? AND bank = ? AND uid NOT LIKE 'csv-%' AND (
      (iban IS NOT NULL AND upper(replace(iban, ' ', '')) = ?)
      OR (iban IS NULL AND ? IS NULL AND coalesce(name, '') = ? AND coalesce(currency, '') = ?))`);
  const upsert = db.prepare(`
    INSERT INTO accounts (uid, session_id, bank, iban, name, currency) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET session_id = excluded.session_id`);
  const moveTx = db.prepare('UPDATE transactions SET id = ? || substr(id, ?), account_uid = ? WHERE account_uid = ?');
  const moveMirrors = db.prepare('UPDATE transactions SET mirror_of = ? || substr(mirror_of, ?) WHERE mirror_of LIKE ?');
  const copyState = db.prepare(`UPDATE accounts SET balance_cents = o.balance_cents, balance_date = o.balance_date, last_synced = o.last_synced
                                FROM (SELECT * FROM accounts WHERE uid = ?) AS o WHERE accounts.uid = ?`);
  const linked = [];
  db.exec('BEGIN');
  try {
    removeSampleData(); // your own bank is in: the sample data would only mix with it
    db.prepare('INSERT OR REPLACE INTO sessions (id, bank, valid_until) VALUES (?, ?, ?)')
      .run(session.session_id, bankName, session.access?.valid_until ?? validUntil);
    for (const a of accounts) {
      const iban = a.account_id?.iban ? normIban(a.account_id.iban) : null;
      const name = a.name ?? a.product ?? null;
      const old = findOld.get(a.uid, bankName, iban ?? '', iban, name ?? '', a.currency ?? '');
      upsert.run(a.uid, session.session_id, bankName, iban, name, a.currency ?? null);
      if (old) {
        moveTx.run(a.uid, old.uid.length + 1, a.uid, old.uid);
        moveMirrors.run(a.uid, old.uid.length + 1, `${old.uid}:%`);
        copyState.run(old.uid, a.uid);
        db.prepare('DELETE FROM accounts WHERE uid = ?').run(old.uid);
      }
      linked.push({ uid: a.uid, iban, name, renewed: !!old });
    }
    db.prepare('DELETE FROM sessions WHERE id NOT IN (SELECT session_id FROM accounts)').run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { bank: bankName, validUntil: session.access?.valid_until ?? validUntil, accounts: linked };
}

// For a browser tab: catch the bank's redirect on EB_REDIRECT_URL (https://localhost:3443/callback), using
// the certificate from `npm run cert`. Stops once a link finished, or after 15 minutes.
function listenForRedirect(redirectUrl) {
  const target = new URL(redirectUrl);
  const key = join(PROJECT, 'secrets', 'localhost-key.pem');
  const cert = join(PROJECT, 'secrets', 'localhost-cert.pem');
  // Only on this computer (like `npm run link`): never open a port other machines could reach.
  if (target.protocol !== 'https:' || !LOCAL_HOSTS.has(target.hostname) || !existsSync(key) || !existsSync(cert) || globalThis.__muntoRedirectServer) return;
  const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
    <body style="font:16px system-ui;background:#f3eee4;color:#17251f;display:grid;place-items:center;height:90vh">
    <div><h1 style="font-size:22px">${title}</h1><p>${text}</p></div>`;
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (req, res) => {
    const url = new URL(req.url, redirectUrl);
    if (url.pathname !== target.pathname) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    try {
      const result = await finishLink(fromCallback(url.href));
      res.end(page('Bank connected', `${escapeHtml(result.bank)}: ${result.accounts.length} account(s). You can close this tab and go back to Munto.`));
      stop();
    } catch (err) {
      try { failLink(url.searchParams.get('state'), err.message); } catch { /* ignore */ }
      res.end(page('That didn’t work', `${escapeHtml(err.message)} Go back to Munto to try again.`));
    }
  });
  const stop = () => { server.close(); globalThis.__muntoRedirectServer = null; };
  server.on('error', () => stop()); // the port is taken (e.g. `npm run link` is running): paste the address instead
  server.listen(Number(target.port || 443), target.hostname);
  setTimeout(stop, TTL).unref();
  globalThis.__muntoRedirectServer = server;
}
