import { NextResponse } from 'next/server';
import { refuse } from './lib/gate.js';

// Every route goes through the same check (lib/gate.js): local host name, not from another website,
// the desktop app's per-run secret, and changes only as JSON from our own origin.
export function proxy(request) {
  const no = refuse({
    method: request.method,
    path: request.nextUrl.pathname,
    headers: request.headers,
    token: process.env.MUNTO_TOKEN,
  });
  return no ? NextResponse.json({ error: no.error }, { status: no.status }) : NextResponse.next();
}

export const config = {
  // Build files only: the trailing slash keeps paths like /_next/staticX inside the check.
  matcher: '/((?!_next/static/).*)',
};
