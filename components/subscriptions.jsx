'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtDate, fmtMoney, fmtShort, parseEuros, plural, tidy, txLink } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { CategoryChip, Icon, Jar, Money, Segmented, Swatch } from './ui.jsx';

const EVERY = [['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']];
const EVERY_LABEL = { week: 'weekly', month: 'monthly', quarter: 'every 3 months', year: 'yearly' };
const toText = (c) => (c == null ? '' : (c / 100).toLocaleString('nl-BE', { minimumFractionDigits: c % 100 ? 2 : 0 }));
const blank = { id: null, name: '', amount: '', every: 'month', match: '', category: '', byAmount: false, day: '' };
const ordinal = (d) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;
const usesDay = (every) => every === 'month' || every === 'quarter';

export function Subscriptions({ data }) {
  const [editing, setEditing] = useState(null); // a form draft, or null
  const startNew = (from = {}) => setEditing({ ...blank, ...from, id: null, amount: toText(from.amountCents), byAmount: !!from.byAmount, day: from.day ? String(from.day) : '' });
  const { toast, refresh } = useApp();
  async function notOne(x) {
    try { await api('/api/insights/status', { method: 'POST', body: { id: x.id, status: 'hidden' } }); toast(`${x.name} won’t be suggested again`); refresh(); } catch (err) { toast(err.message); }
  }
  const startEdit = (s) => setEditing({ id: s.id, name: s.name, amount: toText(s.amountCents), every: s.every, match: s.match ?? '', category: s.category ?? '', byAmount: !!s.byAmount, day: s.day ? String(s.day) : '' });

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Subscriptions</h1>
        </div>
        {!editing ? <button className="btn btn-ink" type="button" onClick={() => startNew()}><Icon name="plus" />Add a subscription</button> : null}
      </div>

      <div className="subs-top">
        <article className="tile">
          <div className="tile-head"><span className="stamp">A month</span><span className="tile-target">{plural(data.list.length, 'subscription')}</span></div>
          <div className="tile-num"><Money cents={data.monthlyCents} /></div>
          <p className="tile-status">yearly ones spread over 12 months</p>
        </article>
        <article className="tile">
          <div className="tile-head"><span className="stamp">A year</span></div>
          <div className="tile-num"><Money cents={data.yearlyCents} /></div>
        </article>
        <article className="tile subs-upcoming">
          <div className="tile-head"><span className="stamp">Before payday</span><span className="tile-target">{`until ${fmtShort(data.nextPayday)}`}</span></div>
          {data.upcoming.length ? (
            <ul>
              {data.upcoming.map((s) => <li key={s.id}><span>{fmtShort(s.nextDate)}</span><b>{s.name}</b><Money cents={s.amountCents} /></li>)}
            </ul>
          ) : <p className="tile-status">Nothing else due before your next payday.</p>}
        </article>
      </div>

      {editing ? <Form draft={editing} setDraft={setEditing} onDone={() => setEditing(null)} /> : null}

      {data.list.length ? (
        <section className="panel" aria-labelledby="subs-h">
          <div className="panel-head"><h2 id="subs-h">Your subscriptions</h2></div>
          <ul className="subs-list">
            {data.list.map((s) => <Row key={s.id} s={s} onEdit={() => startEdit(s)} />)}
          </ul>
        </section>
      ) : !editing ? (
        <div className="empty"><Jar fill={0} className="jar-empty" /><strong>No subscriptions yet</strong>Add the ones you pay for, or pick one found in your payments below.</div>
      ) : null}

      {data.suggestions.length ? (
        <section className="panel" aria-labelledby="found-h" style={{ marginTop: 18 }}>
          <div className="panel-head"><h2 id="found-h">Found in your payments</h2></div>
          <ul className="subs-found">
            {data.suggestions.map((x) => (
              <li key={`${x.match}:${x.byAmount ? x.amountCents : ''}`}>
                <Swatch category={x.category ?? 'Subscriptions'} size="sm" />
                <div><b>{x.name}</b><span className="sub">{`${fmtMoney(x.amountCents)} ${EVERY_LABEL[x.every] ?? ''}${x.day ? `, around the ${ordinal(x.day)}` : ''} · last ${fmtDate(x.lastDate)}`}</span></div>
                <div className="subs-found-actions">
                  <button className="btn btn-sm btn-ghost" type="button" onClick={() => notOne(x)}>Not a subscription</button>
                  <button className="btn btn-sm" type="button" onClick={() => startNew(x)}>Add</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Row({ s, onEdit }) {
  const { toast, refresh } = useApp();
  async function remove() {
    if (!confirm(`Remove ${s.name} from your subscriptions?`)) return;
    try { await api(`/api/subscriptions/${s.id}`, { method: 'DELETE', body: {} }); toast(`${s.name} removed`); refresh(); } catch (err) { toast(err.message); }
  }
  async function useNewPrice() {
    try {
      await api('/api/subscriptions', { method: 'POST', body: { ...s, amountCents: s.lastCents } });
      toast(`${s.name} is now ${fmtMoney(s.lastCents)}`); refresh();
    } catch (err) { toast(err.message); }
  }
  async function keepAmount() {
    try {
      await api('/api/subscriptions', { method: 'POST', body: { ...s, byAmount: true, day: s.mixed.day } });
      toast(`${s.name} now links only its own payments`); refresh();
    } catch (err) { toast(err.message); }
  }
  const status = !s.match ? { tone: 'muted', text: 'Not linked to payments yet' }
    : !s.lastDate ? { tone: 'over', text: `No payments found with “${s.match}”` }
    : s.late ? { tone: 'over', text: `Not charged since ${fmtDate(s.lastDate)}: cancelled, or paid another way?` }
    : { tone: 'ok', text: `Last charged ${fmtDate(s.lastDate)} · next around ${fmtDate(s.nextDate)}` };
  return (
    <li className="subs-row">
      <Swatch category={s.category ?? 'Subscriptions'} size="sm" />
      <div className="subs-main">
        <div className="subs-name"><b>{s.name}</b></div>
        <p className={`subs-status is-${status.tone}`}>{status.text}</p>
        {s.mixed ? (
          <p className="subs-status is-need">
            {`“${s.match}” links ${plural(s.mixed.count, 'payment')} from ${fmtMoney(s.mixed.low)} to ${fmtMoney(s.mixed.high)}, so it’s probably more than ${s.name}. `}
            <button className="link-btn" type="button" onClick={keepAmount}>
              {`Only link ${fmtMoney(s.amountCents)} payments${s.mixed.day ? ` around the ${ordinal(s.mixed.day)}` : ''}`}
            </button>
          </p>
        ) : s.priceChanged && !s.late ? (
          <p className="subs-status is-over">
            {`The last charge was ${fmtMoney(s.lastCents)}, not the ${fmtMoney(s.amountCents)} you entered. `}
            <button className="link-btn" type="button" onClick={useNewPrice}>{`Use ${fmtMoney(s.lastCents)}`}</button>
          </p>
        ) : null}
        <div className="subs-actions">
          <button className="link-btn" type="button" onClick={onEdit}>Edit</button>
          {s.match ? <Link className="link-btn" href={txLink({ q: s.match, direction: 'out' })}>See transactions</Link> : null}
          <button className="link-btn is-danger" type="button" onClick={remove}>Remove</button>
        </div>
      </div>
      <div className="subs-amounts">
        <b><Money cents={s.amountCents} /></b>
        <span>{`a ${s.every === 'quarter' ? 'quarter' : s.every}`}</span>
      </div>
    </li>
  );
}

// Add or edit: name, price and interval, and the payments it belongs to (searched as you type).
function Form({ draft, setDraft, onDone }) {
  const { toast, refresh } = useApp();
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const q = draft.match.trim();
  useEffect(() => {
    if (q.length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api(`/api/subscriptions/search?q=${encodeURIComponent(q)}`).then((r) => setResults(r.results)).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // Which payments it would link, as you fill it in.
  const amountNow = parseEuros(draft.amount);
  const day = Number(draft.day) || null;
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (q.length < 3) { setPreview(null); return undefined; }
    const params = new URLSearchParams({ match: q, every: draft.every, amountCents: String(amountNow ?? 0), byAmount: draft.byAmount ? '1' : '', day: draft.byAmount && day ? String(day) : '' });
    const t = setTimeout(() => {
      api(`/api/subscriptions/preview?${params}`).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [q, draft.every, amountNow, draft.byAmount, day]);
  const picked = results.find((r) => r.match === draft.match) ?? results.find((r) => r.varied && r.match.includes(q.toLowerCase()));

  async function save(e) {
    e.preventDefault();
    const amountCents = parseEuros(draft.amount);
    if (!draft.name.trim()) { setError('Give it a name, like Spotify'); return; }
    if (!(amountCents > 0)) { setError('Type what it costs, like 10,99'); return; }
    setBusy(true); setError(null);
    try {
      await api('/api/subscriptions', { method: 'POST', body: { id: draft.id, name: draft.name, amountCents, every: draft.every, match: draft.match, category: draft.category || null,
        byAmount: draft.byAmount, day: draft.byAmount && usesDay(draft.every) && day ? day : null } });
      toast(draft.id ? `${draft.name} updated` : `${draft.name} added`);
      onDone();
      refresh();
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  const amount = parseEuros(draft.amount);
  const perYear = { week: 52, month: 12, quarter: 4, year: 1 }[draft.every];
  return (
    <section className="panel subs-form" aria-labelledby="form-h">
      <div className="panel-head"><h2 id="form-h">{draft.id ? `Edit ${draft.name}` : 'Add a subscription'}</h2></div>
      <form onSubmit={save}>
        <div className="subs-fields">
          <label className="field-col"><span>Name</span>
            <input type="text" placeholder="Spotify" value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></label>
          <label className="field-col"><span>Price</span>
            <span className="money-input"><span aria-hidden="true">€</span>
              <input type="text" inputMode="decimal" placeholder="10,99" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} aria-label="Price" /></span></label>
          <div className="field-col"><span>Charged every</span>
            <Segmented label="Charged every" options={EVERY} value={draft.every} onChange={(every) => set({ every })} /></div>
          <div className="field-col"><span>Pot</span>
            <CategoryChip label="Pot" value={draft.category} onChange={(category) => set({ category })} placeholder="Choose…" includeNone={false} /></div>
        </div>
        {amount > 0 ? (
          <p className="sub subs-calc">{`That’s ${fmtMoney(Math.round((amount * perYear) / 12))} a month, ${fmtMoney(amount * perYear)} a year.`}</p>
        ) : null}

        <label className="field-col subs-link"><span>Linked payments: text that appears in them</span>
          <input type="search" placeholder="e.g. spotify" value={draft.match} onChange={(e) => set({ match: e.target.value })} /></label>
        {results.length ? (
          <ul className="subs-results" aria-label="Payments that match">
            {results.map((r) => (
              <li key={r.key}>
                <button type="button" className={draft.match === r.match ? 'is-picked' : ''}
                  onClick={() => set({ match: r.match, name: draft.name || r.name, amount: draft.amount || toText(r.lastCents), category: draft.category || r.category || '' })}>
                  <b>{tidy(r.key)}</b>
                  <span>{`${plural(r.count, 'payment')} · last ${fmtMoney(r.lastCents)} on ${fmtShort(r.lastDate)}`}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : q.length >= 2 ? <p className="sub">No payments contain “{q}”.</p> : null}

        {picked?.varied && picked.amounts.length ? (
          <div className="subs-amounts-pick">
            <p className="sub">{`${tidy(picked.key)} pays for many different things. Which amount is it?`}</p>
            <ul>
              {picked.amounts.map((a) => (
                <li key={a.cents}>
                  <button type="button" className={draft.byAmount && amountNow === a.cents ? 'is-picked' : ''}
                    onClick={() => set({ amount: toText(a.cents), byAmount: true, day: String(a.day), every: draft.every === 'week' ? 'month' : draft.every })}>
                    <b>{fmtMoney(a.cents)}</b><span>{`${a.count}× · around the ${ordinal(a.day)}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {q.length >= 3 ? (
          <div className="subs-narrow">
            <label className="check">
              <input type="checkbox" checked={draft.byAmount} onChange={(e) => set({ byAmount: e.target.checked })} />
              <span>{`Only payments of about ${amountNow > 0 ? fmtMoney(amountNow) : 'this price'}`}</span>
            </label>
            {draft.byAmount && usesDay(draft.every) ? (
              <label className="subs-day">
                <span>around day</span>
                <input type="text" inputMode="numeric" placeholder="any" value={draft.day} onChange={(e) => set({ day: e.target.value.replace(/\D/g, '').slice(0, 2) })} aria-label="Day of the month it's charged" />
                <span>of the month</span>
              </label>
            ) : null}
          </div>
        ) : null}
        {preview ? (
          <p className={`sub subs-preview${preview.count ? '' : ' is-empty'}`}>
            {preview.count
              ? <>{`Links ${plural(preview.count, 'payment')}: `}{preview.charges.map((c) => `${fmtShort(c.date)} ${fmtMoney(c.cents)}`).join(' · ')}{preview.count > preview.charges.length ? ' …' : ''}</>
              : 'No payments match yet. Check the amount or the day.'}
          </p>
        ) : null}

        {error ? <div className="error-text" role="alert">{error}</div> : null}
        <div className="inline-form">
          <button className={`btn btn-ink${busy ? ' is-busy' : ''}`} type="submit" disabled={busy}><Icon name="check" />{draft.id ? 'Save changes' : 'Add subscription'}</button>
          <button className="btn btn-ghost" type="button" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
