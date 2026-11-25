'use client';
import { useState } from 'react';
import Link from 'next/link';
import { look } from '@/lib/look.js';
import { fmtDate, fmtMoney, plural, tidy, txLink } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { Icon, Jar, Money, Segmented, Spinner } from './ui.jsx';

const whole = (cents) => fmtMoney(Math.round(cents / 100) * 100).replace(/,00$/, '');
const exact = (cents) => fmtMoney(cents);
const FILTERS = [
  ['all', 'All'], ['subscription', 'Repeating'], ['creep', 'Crept up'], ['frequent', 'Small & often'], ['want', 'Biggest wants'], ['check', 'To check'],
];
const kindOf = (i) => (i.kind === 'price' ? 'subscription' : i.kind === 'duplicate' ? 'check' : i.kind);
const ICON = { subscription: 'subscriptions', price: 'growth', creep: 'growth', frequent: 'list', duplicate: 'inbox', want: 'sparkle' };

// The local wording of a finding: a title, a sentence, and what the yearly figure means.
export function describe(i) {
  // A payer like PayPal: its first word, since the amount is what tells its subscriptions apart.
  const name = i.kind === 'creep' || i.kind === 'want' ? look(i.category).label : i.byAmount ? tidy(i.key).split(' ')[0] : tidy(i.key);
  switch (i.kind) {
    case 'subscription':
      return { name, title: `${name}: ${exact(i.amountCents)} a ${i.interval}`, text: `Charged every ${i.interval}${i.day ? ` around the ${i.day}${['th', 'st', 'nd', 'rd'][i.day % 10 > 3 || [11, 12, 13].includes(i.day) ? 0 : i.day % 10]}` : ''} since ${fmtDate(i.firstDate)} (${plural(i.count, 'time')}). ${i.byAmount ? 'Add it on Subscriptions to name it. ' : ''}Still worth it?`, yearly: 'a year' };
    case 'price':
      return { name, title: `${name} got more expensive`, text: `From ${exact(i.fromCents)} to ${exact(i.amountCents)} a ${i.interval}, since ${fmtDate(i.since)}. Worth checking for a cheaper plan.`, yearly: 'extra a year' };
    case 'creep':
      return { name, title: `${name} crept up`, text: `${whole(i.earlierCents)} a month before, ${whole(i.recentCents)} in a typical month lately.${i.drivers.length ? ` Most of the rise: ${i.drivers.map((d) => `${tidy(d.who)} (+${whole(d.deltaCents)})`).join(', ')}.` : ''}`, yearly: 'more a year' };
    case 'frequent':
      return { name, title: `${name}: ${i.count}× in 3 months`, text: `${exact(i.averageCents)} each time, about ${whole(i.monthlyCents)} a month. Half as often would save the amount shown.`, yearly: 'a year if halved' };
    case 'duplicate':
      return { name, title: `Possible double charge at ${name}`, text: `Two payments of ${exact(i.amountCents)} on ${i.dates.map(fmtDate).join(' and ')}. If it’s a mistake, ask for a refund.`, yearly: 'to check' };
    case 'want':
      return { name, title: `${name}: ${Math.round(i.shareOfIncome * 100)}% of your income`, text: `${whole(i.monthlyCents)} a month on average. Your wants are over their share; this pot’s part of that is ${whole(i.cutCents)} a month.`, yearly: 'a year to bring in line' };
    default:
      return { name, title: name, text: '', yearly: 'a year' };
  }
}
const hrefOf = (i) => (i.kind === 'creep' || i.kind === 'want' ? txLink({ category: i.category })
  : txLink({ q: i.key.toLowerCase(), direction: 'out' }));

export function Cut({ data }) {
  const { config, toast, refresh } = useApp();
  const aiName = config.aiName ?? 'AI'; // whichever AI you chose under Settings
  const [filter, setFilter] = useState('all');
  const [ai, setAi] = useState(data.ai);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const open = data.items.filter((i) => i.status === 'new' || i.status === 'cancelling');
  const done = data.items.filter((i) => i.status === 'kept' || i.status === 'hidden');
  // Claude's order first (if asked), then the rest by yearly figure.
  const rank = new Map((ai?.ranked ?? []).map((r, n) => [r.id, { ...r, n }]));
  // Fixed costs (needs) go after the rest: they're for comparing offers, not for cancelling.
  const isNeed = (i) => i.group === 'needs';
  const ordered = [...open].sort((a, b) => (rank.get(a.id)?.n ?? 999) - (rank.get(b.id)?.n ?? 999)
    || isNeed(a) - isNeed(b) || b.yearlyCents - a.yearlyCents);
  const needs = open.filter(isNeed).length;
  const shown = ordered.filter((i) => filter === 'all' || kindOf(i) === filter);
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === 'all' ? open.length : open.filter((i) => kindOf(i) === k).length]));

  async function setStatus(i, status, message) {
    try {
      await api('/api/insights/status', { method: 'POST', body: { id: i.id, status } });
      toast(message);
      refresh();
    } catch (err) { toast(err.message); }
  }
  async function askClaude() {
    setAiBusy(true); setAiError(null);
    try { setAi(await api('/api/insights/ai', { method: 'POST', body: {} })); } catch (err) { setAiError(err.message); }
    setAiBusy(false);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Where to cut</h1>
        </div>
      </div>

      <section className="panel cut-hero" aria-label="What you could save">
        <div>
          <span className="stamp">Up to</span>
          <div className="story-total"><Money cents={data.potentialCents} /></div>
          <p className="story-fun">{`a year across ${plural(open.length - needs, 'tip')}, if you acted on all of them. Pick the ones that feel easy.`}
            {needs ? ` Fixed costs like rent and energy aren’t counted.` : ''}</p>
        </div>
        {data.wins.length ? (
          <div className="cut-wins">
            <span className="stamp">Done</span>
            {data.wins.map((w) => <p key={w.id}><Icon name="check" />{`${tidy(w.key)} stopped charging you`}</p>)}
          </div>
        ) : null}
      </section>

      <div className={`ai-bar budget-ai${config.aiConfigured ? '' : ' is-quiet'}`} role="region" aria-label="AI tips">
        <span className="ai-mark">{aiBusy ? <Spinner /> : <Icon name="sparkle" />}</span>
        {!config.aiConfigured ? (
          <div className="ai-text"><strong>Ranked by yearly amount</strong><p>Choose an AI under <Link href="/settings">Settings</Link> to have it rank these by what’s most worth doing, with a concrete tip for each.</p></div>
        ) : aiBusy ? (
          <div className="ai-text"><strong>{`${aiName} is looking at your tips…`}</strong><p>Only merchant and pot names with their amounts are sent. No descriptions, IBANs or other transactions.</p></div>
        ) : aiError ? (
          <><div className="ai-text"><strong>AI tips aren’t available right now</strong><p>{aiError}</p></div>
            <button className="btn btn-sm" type="button" onClick={askClaude}>Try again</button></>
        ) : ai ? (
          <><div className="ai-text"><strong>{`${aiName}’s take`}</strong><p>{ai.summary}</p></div>
            <button className="btn btn-sm" type="button" onClick={askClaude}>Ask again</button></>
        ) : (
          <><div className="ai-text"><strong>{`Ask ${aiName} what’s most worth it`}</strong><p>It ranks these by impact and effort, skips the essentials, and gives one concrete tip each. Only names and amounts are sent.</p></div>
            <button className="btn btn-need" type="button" onClick={askClaude} disabled={!open.length}><Icon name="sparkle" />Rank my tips</button></>
        )}
      </div>

      {open.length ? (
        <>
          <Segmented className="cut-filters" label="Show" value={filter} onChange={setFilter}
            options={FILTERS.filter(([k]) => k === 'all' || counts[k]).map(([k, l]) => [k, `${l} ${counts[k]}`])} />
          <ul className="cut-list">
            {shown.map((i) => <Tip key={i.id} i={i} ai={rank.get(i.id)} aiName={aiName} setStatus={setStatus} />)}
          </ul>
        </>
      ) : (
        <div className="empty"><Jar fill={0} className="jar-empty" /><strong>Nothing stands out</strong>No subscriptions, price rises or creeping pots to look at right now.</div>
      )}

      {done.length ? (
        <div className="cut-done">
          <button className="btn btn-sm pay-toggle" type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
            <Icon name="down" />{showDone ? 'Hide' : `${plural(done.length, 'tip')} you kept or hid`}
          </button>
          {showDone ? (
            <ul className="cut-list is-done">
              {done.map((i) => {
                const d = describe(i);
                return (
                  <li key={i.id} className="cut-done-row">
                    <span>{d.title}</span>
                    <span className="sub">{i.status === 'kept' ? `Kept · ${fmtDate(i.statusAt)}` : `Hidden · ${fmtDate(i.statusAt)}`}</span>
                    <button className="link-btn" type="button" onClick={() => setStatus(i, null, 'Back on the list')}>Put back</button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Tip({ i, ai, aiName, setStatus }) {
  const d = describe(i);
  const l = look(i.category);
  const cancelling = i.status === 'cancelling';
  const need = i.group === 'needs';
  // A fixed cost (rent, energy, insurance) isn't something to cancel; at most to compare.
  const canCancel = (i.kind === 'subscription' || i.kind === 'price') && !need;
  const text = need && i.kind === 'subscription' ? d.text.replace(/Still worth it\?$/, 'A fixed cost: worth comparing offers now and then.') : d.text;
  return (
    <li className={`cut-tip is-${i.kind}${cancelling ? ' is-cancelling' : ''}`}>
      <span className="cut-icon" style={{ '--c': l.color }}><Icon name={ICON[i.kind]} /></span>
      <div className="cut-body">
        <div className="cut-title">
          <strong>{ai?.title ?? d.title}</strong>
          <span className={`group-tag is-${i.group}`}>{i.group === 'needs' ? 'Need' : 'Want'}</span>
          {ai ? <span className="cut-rank" title={`${aiName}’s ranking`}>{`#${ai.n + 1}`}</span> : null}
        </div>
        <p className="cut-text">{text}</p>
        {ai?.tip ? <p className="cut-ai"><Icon name="sparkle" />{ai.tip}{ai.monthlyEuros ? <b>{` ≈ ${fmtMoney(ai.monthlyEuros * 100).replace(/,00$/, '')} a month`}</b> : null}</p> : null}
        {cancelling ? (
          <p className={`cut-follow${i.chargedSince ? ' is-over' : ''}`}>
            {i.chargedSince ? `You said you’d cancel on ${fmtDate(i.statusAt)}, but it was charged again on ${fmtDate(i.chargedSince)}.`
              : `Cancelling since ${fmtDate(i.statusAt)}. It disappears from here once it stops being charged.`}
          </p>
        ) : null}
        <div className="cut-actions">
          {canCancel && !cancelling ? <button className="btn btn-sm btn-ink" type="button" onClick={() => setStatus(i, 'cancelling', `Following ${d.name}: it’ll show here if it’s charged again`)}>I’ll cancel it</button> : null}
          {cancelling && i.chargedSince ? <button className="btn btn-sm" type="button" onClick={() => setStatus(i, 'cancelling', 'Following it again from today')}>Still cancelling</button> : null}
          <button className="btn btn-sm" type="button" onClick={() => setStatus(i, 'kept', `Kept ${d.name}: it won’t come up again`)}>{cancelling ? 'Keep it after all' : need ? 'It’s fine' : 'It’s worth it'}</button>
          {!cancelling ? <button className="btn btn-sm btn-ghost" type="button" onClick={() => setStatus(i, 'hidden', 'Hidden')}>Hide</button> : null}
          <Link className="link-btn" href={hrefOf(i)}>See transactions</Link>
        </div>
      </div>
      <div className="cut-amount">
        <b className={i.kind === 'duplicate' || need ? 'is-quiet' : ''}><Money cents={i.yearlyCents} /></b>
        <span>{need && i.kind === 'subscription' ? 'a year, fixed' : d.yearly}</span>
      </div>
    </li>
  );
}
