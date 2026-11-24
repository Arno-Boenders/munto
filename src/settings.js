// App settings that aren't yours to budget with: how Munto talks to Enable Banking. They live in
// settings.json in your data folder (set on the Settings page), with the private key next to it as
// enablebanking.pem, both readable only by you. Values in .env still win, so an existing setup keeps working.
import { createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { PROJECT, dbPath, privateDir, privateFile } from './paths.js';

export const DEFAULT_REDIRECT = 'https://localhost:3443/callback';
const folder = () => dirname(dbPath());
const file = () => join(folder(), 'settings.json');
export const keyFile = () => join(folder(), 'enablebanking.pem');

export function loadSettings() {
  try { return JSON.parse(readFileSync(file(), 'utf8')); } catch { return {}; }
}

export function saveSettings(settings) {
  privateDir(folder());
  writeFileSync(file(), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  privateFile(file());
}

// What Enable Banking needs, and where each value came from.
export function enableBanking(env = process.env) {
  const s = loadSettings().enableBanking ?? {};
  const keyFromEnv = env.EB_PRIVATE_KEY_PATH ? (isAbsolute(env.EB_PRIVATE_KEY_PATH) ? env.EB_PRIVATE_KEY_PATH : join(PROJECT, env.EB_PRIVATE_KEY_PATH)) : null;
  // A key set up the .env way is a file you saved yourself, often readable by every account on the computer:
  // it gets the same 600 as the one saved from the Settings page.
  if (keyFromEnv) privateFile(keyFromEnv);
  const keyPath = keyFromEnv ?? (existsSync(keyFile()) ? keyFile() : null);
  return {
    appId: env.EB_APP_ID || s.appId || null,
    keyPath,
    country: env.EB_COUNTRY || s.country || 'BE',
    redirectUrl: env.EB_REDIRECT_URL || s.redirectUrl || DEFAULT_REDIRECT,
    source: env.EB_APP_ID ? '.env' : s.appId ? 'settings' : null,
  };
}

export const isConfigured = (eb = enableBanking()) => !!(eb.appId && eb.keyPath && existsSync(eb.keyPath));

// Checks what you pasted and chose before anything is saved. Returns the cleaned-up values.
export function checkEnableBanking({ appId, keyPem, country, redirectUrl }) {
  const id = String(appId ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('The application ID looks like 8-4-4-4-12 letters and digits, e.g. aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  }
  const pem = String(keyPem ?? '').trim();
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('not RSA');
  } catch {
    throw new Error('That file isn’t the private key from Enable Banking: choose the .pem file you downloaded when you registered the application');
  }
  const cc = String(country ?? 'BE').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw new Error('The country is a two-letter code, like BE');
  let redirect = String(redirectUrl ?? '').trim() || DEFAULT_REDIRECT;
  try { if (new URL(redirect).protocol !== 'https:') throw new Error(); } catch { throw new Error('The redirect URL must be an https address, the same as on your Enable Banking application'); }
  return { appId: id, keyPem: `${pem}\n`, country: cc, redirectUrl: redirect };
}

export function saveEnableBanking({ appId, keyPem, country, redirectUrl }) {
  privateDir(folder());
  writeFileSync(keyFile(), keyPem, { mode: 0o600 });
  privateFile(keyFile());
  const settings = loadSettings();
  settings.enableBanking = { appId, country, redirectUrl };
  saveSettings(settings);
}
