// Minimal Enable Banking API client. Docs: https://enablebanking.com/docs/api/reference/
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { enableBanking } from './settings.js';

const API = 'https://api.enablebanking.com';

const base64url = (input) => Buffer.from(input).toString('base64url');

// Every request is authenticated with a short-lived RS256 JWT signed by the app's private key. The ID and key
// come from your settings (the Settings page) or .env; `creds` lets the Settings page test new ones before saving.
function makeJwt(creds) {
  const eb = creds ?? enableBanking();
  if (!eb.appId) throw new Error('Enable Banking isn’t set up yet: open the Settings page (or set EB_APP_ID in .env)');
  const privateKey = eb.keyPem ?? (eb.keyPath ? readFileSync(eb.keyPath, 'utf8') : null);
  if (!privateKey) throw new Error('No Enable Banking private key yet: add it on the Settings page');
  const iat = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'RS256', kid: eb.appId };
  const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

async function request(method, path, body, creds) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${makeJwt(creds)}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Enable Banking ${method} ${path} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

export const listBanks = (country) =>
  request('GET', `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`).then((r) => r.aspsps);

export const startAuth = ({ bank, country, redirectUrl, state, validUntil }) =>
  request('POST', '/auth', {
    access: { valid_until: validUntil.toISOString() },
    aspsp: { name: bank, country },
    state,
    redirect_url: redirectUrl,
    psu_type: 'personal',
  });

export const createSession = (code) => request('POST', '/sessions', { code });
export const getSession = (id) => request('GET', `/sessions/${encodeURIComponent(id)}`);

export const getBalances = (accountUid) =>
  request('GET', `/accounts/${encodeURIComponent(accountUid)}/balances`).then((r) => r.balances);

// Transactions are paginated; follow continuation_key until the bank says there is no more. A key that
// comes back twice, or more pages than any real history needs, means the answer is broken: stop.
const MAX_PAGES = 500;
export async function getTransactions(accountUid, dateFrom) {
  const all = [];
  const keys = new Set();
  let continuationKey;
  do {
    if (keys.size >= MAX_PAGES) throw new Error(`The bank kept sending more pages (over ${MAX_PAGES}); try again later`);
    const params = new URLSearchParams({ date_from: dateFrom });
    if (continuationKey) params.set('continuation_key', continuationKey);
    const page = await request('GET', `/accounts/${encodeURIComponent(accountUid)}/transactions?${params}`);
    all.push(...(page.transactions ?? []));
    continuationKey = page.continuation_key;
    if (continuationKey && keys.has(continuationKey)) throw new Error('The bank sent the same page twice; try again later');
    if (continuationKey) keys.add(continuationKey);
  } while (continuationKey);
  return all;
}

// For the Settings page: do these credentials work? Lists the banks for the country, signed with them.
export const testCredentials = (creds) => request('GET', `/aspsps?country=${encodeURIComponent(creds.country)}&psu_type=personal`, null, creds)
  .then((r) => r.aspsps.length);
