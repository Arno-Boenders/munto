// `npm run ui`: Next.js in development mode behind the same check as proxy.js (lib/gate.js).
// `next dev` answers its own dev endpoints before proxy.js runs, and one of them opens a Node debugger with
// no password, which another account on this computer could use to run code as you. Here every request
// (and the live-reload WebSocket) is checked first, and Next's dev endpoints are off except the few the
// error overlay and fonts need.
import { createServer } from 'node:http';
import next from 'next';
import { refuse, sameLocalOrigin } from '../lib/gate.js';

const port = Number(process.env.PORT || 4000);
const hostname = '127.0.0.1';
const token = process.env.MUNTO_TOKEN; // normally unset here; if set, it's required, as in proxy.js

// The path as Next will see it: decoded, without repeated slashes, lower case for comparing. Something
// that doesn't decode, or that climbs with "..", is refused rather than guessed at.
function devPath(url) {
  const raw = String(url ?? '/').split('?')[0];
  let path;
  try { path = decodeURIComponent(raw); } catch { return null; }
  if (path.includes('\\') || path.split('/').includes('..')) return null;
  return path.replace(/\/{2,}/g, '/').toLowerCase();
}
// Next's own dev endpoints: only reading stack frames and source maps (the error overlay), the server
// status and fonts. Not the debugger, the editor launcher, restarts, devtools settings or the MCP server.
const DEV_ALLOWED = ['/__nextjs_source-map', '/__nextjs_original-stack-frames', '/__nextjs_original-stack-frame', '/__nextjs_server_status'];
function devEndpointOff(path) {
  if (path === '/_next/mcp' || path.startsWith('/_next/mcp/')) return true;
  if (!path.includes('__nextjs')) return false;
  if (path.startsWith('/__nextjs_font/')) return false;
  return !DEV_ALLOWED.some((p) => path === p || path === `${p}/`);
}

function check(req) {
  const path = devPath(req.url);
  if (path == null) return { status: 400, error: 'Bad path' };
  if (devEndpointOff(path)) return { status: 404, error: 'Not available' };
  return refuse({ method: req.method, path, headers: { get: (name) => req.headers[name] ?? null }, token });
}

const app = next({ dev: true, hostname, port, turbopack: true });
await app.prepare();
const handle = app.getRequestHandler();

const server = createServer((req, res) => {
  const no = check(req);
  if (no) {
    res.writeHead(no.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: no.error }));
    return;
  }
  handle(req, res);
});
// Live reload runs over a WebSocket. Refused ones are closed here; Next takes the rest (it listens on
// this server's upgrades itself once the first page has been requested).
server.on('upgrade', (req, socket) => {
  const origin = req.headers.origin;
  if (check({ url: req.url, headers: req.headers, method: 'GET' }) || (origin != null && !sameLocalOrigin(origin, req.headers.host ?? ''))) socket.destroy();
});
server.listen(port, hostname, () => console.log(`Munto (development) on http://localhost:${port}`));
