// Formatting shared by every page. Dates are ISO strings (YYYY-MM-DD), money is integer cents.

export const money = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
// Unsigned amounts read as spend ("€ 24,00"); signed ones put a true minus or plus before the euro sign.
export const fmtMoney = (cents) => (cents < 0 ? '−' : '') + money.format(Math.abs(cents ?? 0) / 100);
export const signed = (cents) => (cents > 0 ? '+' : '') + fmtMoney(cents);
export const fmtDate = (iso) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtShort = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
// "25 Sep – 24 Oct", or "since 25 Sep" while the month is still running (it ends on the next payday).
export const fmtPeriod = (p) => (p.end ? `${fmtShort(p.start)} – ${fmtShort(p.end)}` : `since ${fmtShort(p.start)}`);
export const fmtDay = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtMonth = (ym, style = 'long') =>
  new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: style, year: style === 'long' ? 'numeric' : undefined });
// Drops the boilerplate some banks put in front of card payments: "BETALING MET DEBETKAART NUMMER 1234 56XX XXXX 1234 ".
export const cleanDesc = (text) => (text ?? '').replace(/^(BETALING MET (DEBETKAART|BANKKAART|KREDIETKAART) NUMMER [\dX ]+)/i, '').trim();
export const fmtIban = (iban) => (iban ?? '').replace(/(.{4})/g, '$1 ').trim();
export const daysUntil = (iso) => Math.ceil((new Date(iso) - new Date()) / 86400000);
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// "DOE JANE" -> "Doe Jane"; leaves mixed-case names alone.
export const tidy = (name) => (name && name === name.toUpperCase()
  ? name.toLowerCase().replace(/(^|[\s\-'/(.&])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  : name ?? '');

export const txLink = (params) => `/transactions?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))}`;
export const addDaysIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
export const previousMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
export const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0);
export function niceStep(max, targetTicks = 4) {
  const raw = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((step) => raw <= step);
}
// Database rows have no prototype; a JSON round trip makes them plain objects for client components.
export const plain = (value) => JSON.parse(JSON.stringify(value));
// "2.500", "2500,50", "€ 2 500" -> cents; null when it isn't an amount.
export function parseEuros(text) {
  let t = String(text ?? '').replace(/[€\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return t && Number.isFinite(n) ? Math.round(n * 100) : null;
}

// A rule's pattern as the words a person reads: "\bloon\b|salaris" → [{ text: 'loon', whole: true },
// { text: 'salaris' }]. A part that uses more of regex than word edges and escaped characters is shown as
// written (raw), so nothing is hidden.
export function ruleWords(match) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < match.length; i++) {
    const c = match[i];
    if (c === '\\') { i++; continue; }
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth) depth--;
    else if (c === '|' && !depth) { parts.push(match.slice(start, i)); start = i + 1; }
  }
  parts.push(match.slice(start));
  return parts.filter(Boolean).map((part) => {
    const lead = part.startsWith('\\b');
    const tail = part.endsWith('\\b') && !part.endsWith('\\\\b');
    const core = part.slice(lead ? 2 : 0, tail ? -2 : undefined);
    if (/(^|[^\\])[[\](){}*+?^$.|]/.test(core) || /\\[^.*+?^${}()|[\]\\/&\-]/.test(core)) return { text: part, raw: true };
    return { text: core.replace(/\\(.)/g, '$1'), whole: lead && tail };
  });
}
