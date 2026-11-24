// What went wrong, said so you know what to do next. Errors the server words itself ("Pick a category")
// come through as they are; the rest get a sentence instead of a status code.
const SAYS = {
  offline: 'Munto isn’t answering. Is it still running? Open it again, then try once more.',
  stale: 'Munto turned this down because the page is out of date. Reload the page and try again.',
  404: 'This version of Munto doesn’t know that yet. Reload the page; if it stays, update Munto.',
  500: 'Something went wrong in Munto. Try again; if it keeps happening, restart Munto.',
};

// status: an HTTP status, or 'offline' when the request never got an answer. said: the server's own words.
export function errorText(status, said) {
  if (status === 'offline') return SAYS.offline;
  if (status === 403 || status === 415) return SAYS.stale; // the proxy turning down a request (see proxy.js)
  if (status === 404 && /^No route for /.test(said ?? '')) return SAYS[404]; // the API doesn't have it: an old page
  return said || SAYS[status] || SAYS[500];
}
