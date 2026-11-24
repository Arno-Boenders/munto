// Who may talk to the local server. proxy.js runs this for every route, and the dev server
// (scripts/dev-server.mjs) runs it too, before Next's own dev endpoints that proxy.js never sees.
// Returns null when the request may go on, or { status, error } to refuse it.
import { timingSafeEqual } from 'node:crypto';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

// "localhost:4000" -> "localhost", "[::1]:4000" -> "[::1]".
const hostOnly = (host) => String(host ?? '').replace(/:\d+$/, '');

// An Origin header from this machine on the same port as the request: other local servers (another app on
// another port) don't count as us. `Origin: null` and anything unparsable are not ours.
export function sameLocalOrigin(origin, host) {
  try {
    const url = new URL(origin);
    return LOCAL.has(url.hostname.replace(/^::1$/, '[::1]')) && url.host === host;
  } catch {
    return false;
  }
}

function sameToken(given, token) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ method: string, path: string, headers: { get(name: string): string | null }, token?: string }} req
 */
export function refuse({ method, path, headers, token }) {
  // Only answer requests addressed to this machine. Pages render bank data on the server, so this guards
  // every route, not just the API: it blocks DNS-rebinding tricks from websites.
  const host = headers.get('host') ?? '';
  if (!LOCAL.has(hostOnly(host))) return { status: 403, error: 'Forbidden host' };
  // Nothing a browser says came from another website, not even a read.
  if (headers.get('sec-fetch-site') === 'cross-site') return { status: 403, error: 'Forbidden' };
  // The desktop app runs all the time on a port every account on this computer can reach. It makes a secret
  // when it starts (MUNTO_TOKEN) and adds it to every request from its window and its background sync;
  // without it, nothing is answered.
  if (token && !sameToken(headers.get('x-munto-token'), token)) return { status: 403, error: 'Forbidden' };

  if (method !== 'GET' && method !== 'HEAD') {
    // Changes must come from this UI: a JSON request from our own origin. Other websites can't send these.
    const origin = headers.get('origin');
    if (origin != null && !sameLocalOrigin(origin, host)) return { status: 403, error: 'Forbidden origin' };
    if (path.startsWith('/api/') && !String(headers.get('content-type')).startsWith('application/json')) {
      return { status: 415, error: 'Expected JSON' };
    }
  }
  return null;
}
