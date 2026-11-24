// The JSON API the client components call for changes (and the Unsorted page's AI suggestions).
// Reads mostly happen in server components, which call src/api.js directly.
import { api } from '@/src/api.js';

async function handle(request) {
  try {
    const body = request.method === 'GET' ? {} : await request.json().catch(() => {
      throw Object.assign(new Error('Invalid JSON'), { status: 400 });
    });
    const result = await api(request.method, request.nextUrl.pathname, request.nextUrl.searchParams, body ?? {});
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const status = err.status ?? 500;
    // A crash says nothing useful to the person using Munto ("Cannot read properties of undefined"): it goes to
    // the console in full, and the page gets a plain sentence (see lib/errors.js).
    if (status === 500 && !err.expose) {
      console.error(err);
      return Response.json({ error: null }, { status });
    }
    return Response.json({ error: err.message }, { status });
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
