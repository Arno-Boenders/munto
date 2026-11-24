'use client';
import { useEffect, useMemo, useState } from 'react';
import { fmtDate, fmtMoney, fmtMonth, fmtShort, niceStep, parseEuros, plural, tidy, txLink } from '@/lib/format.js';
import Link from 'next/link';
import { api, tipHandlers, useApp } from './app.jsx';
import { CategoryChip, Icon, Money, SaveBar, Segmented, Swatch, usePref, useWidth } from './ui.jsx';
import { BarChart } from './charts.jsx';

const KINDS = [['salary', 'Salary'], ['other', 'Other income'], ['none', 'Not income']];

// When the month starts and the expected income, edited together and saved with one button (here and in the
// setup guide): the draft, what changed, and what's wrong with it.
export function useIncomeDraft(data) {
  const initial = useMemo(() => ({
    calendar: data.paydayFromDay === 0,
    day: String(data.paydayFromDay || 20),
    expected: data.expectedMonthlyCents ? (data.expectedMonthlyCents / 100).toLocaleString('nl-BE', { minimumFractionDigits: data.expectedMonthlyCents % 100 ? 2 : 0 }) : '',
  }), [data.paydayFromDay, data.expectedMonthlyCents]);
  const [draft, setDraft] = useState(initial);
  useEffect(() => { setDraft(initial); }, [initial]);
  const change = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const day = Number(draft.day);
  const expectedCents = draft.expected.trim() ? parseEuros(draft.expected) : null;
  const changes = {};
  const nextDay = draft.calendar ? 0 : day;
  if (nextDay !== data.paydayFromDay) changes.paydayFromDay = nextDay;
  if ((expectedCents ?? null) !== (data.expectedMonthlyCents ?? null)) changes.expectedMonthlyCents = expectedCents;
  const problem = !draft.calendar && !(Number.isInteger(day) && day >= 1 && day <= 28) ? 'Payday: pick a day between 1 and 28'
    : draft.expected.trim() && !(expectedCents > 0) ? 'Expected income: type an amount, like 2.500' : null;
  return { draft, change, changes, problem, reset: () => setDraft(initial) };
}

export function Income({ data }) {
  const { toast, refresh } = useApp();
  const { draft, change, changes, problem, reset } = useIncomeDraft(data);
  const [saving, setSaving] = useState(false);
  const count = Object.keys(changes).length + (problem && !Object.keys(changes).length ? 1 : 0);

  async function saveAll() {
    setSaving(true);
    try {
      await api('/api/income/settings', { method: 'POST', body: changes });
      toast('Income settings saved');
      refresh();
    } catch (err) { toast(err.message); }
    setSaving(false);
  }

  return (
    <div className={count ? 'has-savebar' : ''}>
      <div className="page-head">
        <div>
          <h1>Income</h1>
        </div>
      </div>
      <IncomeStory data={data} />
      <div className="income-layout">
        <Sources data={data} />
        <div className="income-side">
          <MonthStart data={data} draft={draft} change={change} />
          <Expected data={data} draft={draft} change={change} />
        </div>
      </div>
      {count ? (
        <SaveBar label={problem ?? `${plural(count, 'setting')} changed`} onUndo={reset} onSave={saveAll}
          busy={saving} blocked={problem ? 'Fix it first' : null} />
      ) : null}
    </div>
  );
}

// Runs a change, says how it went, then re-renders from the server.
function useSave() {
  const { toast, refresh } = useApp();
  return async (fn, message) => {
    try {
      const result = await fn();
      toast(typeof message === 'function' ? message(result) : message);
      refresh();
      return true;
    } catch (err) { toast(err.message); return false; }
  };
}

export function MonthStart({ data, draft, change }) {
  return (
    <section className="panel" aria-labelledby="start-h">
      <div className="panel-head"><h2 id="start-h">When your month starts</h2></div>
      <Segmented label="Month starts" value={draft.calendar ? 'calendar' : 'payday'}
        options={[['payday', 'On payday'], ['calendar', 'On the 1st']]}
        onChange={(v) => change({ calendar: v === 'calendar' })} />
      {draft.calendar ? null : (
        <label className="income-day">
          <span>Payday is on or after day</span>
          <input type="number" min="1" max="28" inputMode="numeric" value={draft.day} aria-label="Day of the month"
            onChange={(e) => change({ day: e.target.value })} />
        </label>
      )}
      {data.period ? (
        <p className="sub">
          {`This month started ${fmtDate(data.period.start)}`}
          {data.paydayFromDay === 0 ? '.' : data.period.payday ? ', on payday.' : ': no salary found, so on the 1st.'}
        </p>
      ) : null}
    </section>
  );
}

export function Expected({ data, draft, change }) {
  const current = data.expectedMonthlyCents;
  const suggestion = data.suggestedExpectedCents;
  const typed = draft.expected.trim() ? parseEuros(draft.expected) : null;
  return (
    <section className="panel" aria-labelledby="expected-h" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <h2 id="expected-h">Expected income</h2>
        {current ? <span className="panel-total is-in"><Money cents={current} /></span> : null}
      </div>
      <p className="income-explain">Fills in what’s left before your salary lands. Leave it empty to count only what comes in.</p>
      <div className="inline-form">
        <label className="money-input">
          <span aria-hidden="true">€</span>
          <input type="text" inputMode="decimal" placeholder={suggestion ? (suggestion / 100).toLocaleString('nl-BE') : '2.500'}
            aria-label="Expected income a month" value={draft.expected} onChange={(e) => change({ expected: e.target.value })} />
          <span className="per">a month</span>
        </label>
        {draft.expected ? <button className="btn btn-ghost" type="button" onClick={() => change({ expected: '' })}>Clear</button> : null}
      </div>
      {suggestion && suggestion !== typed ? (
        <p className="sub" style={{ marginTop: 10 }}>
          {'Your usual: '}<b>{fmtMoney(suggestion)}</b>{'. '}
          <button className="link-btn" type="button" onClick={() => change({ expected: (suggestion / 100).toLocaleString('nl-BE', { minimumFractionDigits: suggestion % 100 ? 2 : 0 }) })}>Use this</button>
        </p>
      ) : null}
    </section>
  );
}

function Sources({ data }) {
  return (
    <section className="panel" aria-labelledby="src-h">
      <div className="panel-head">
        <h2 id="src-h">Who pays you</h2>
        <span className="sub">Last 6 months</span>
      </div>
      <p className="income-explain"><b>Salary</b> starts your month; <b>Not income</b> goes back into a pot as paid back.</p>
      {data.sources.length ? (
        <ul className="src-list">
          {data.sources.map((s) => <Source key={s.key} source={s} incomeCategory={data.incomeCategory} />)}
        </ul>
      ) : <p className="empty-line">No money came in over the last 6 months.</p>}
    </section>
  );
}

function Source({ source: s, incomeCategory }) {
  const save = useSave();
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  const isIncome = s.kind !== 'none';
  const oneOffs = s.payments.filter((p) => p.oneOff).length;
  const name = tidy(s.key);

  const setKind = (kind, category) => save(
    () => api('/api/income/source', { method: 'POST', body: { key: s.key, kind, category } }),
    (r) => {
      const what = kind === 'salary' ? 'your salary' : kind === 'other' ? 'other income' : `paid back into ${category}`;
      return r.rule ? `${name} now counts as ${what}` : `${name} counts as ${what} for these payments; new ones follow your rules`;
    },
  ).then((ok) => { if (ok) setPicking(false); });

  const meta = [
    plural(s.count, 'payment'),
    s.usualCents ? `usually ${fmtMoney(s.usualCents)}` : null,
    `last ${fmtShort(s.lastDate)}`,
  ].filter(Boolean).join(' · ');

  return (
    <li className="src">
      <Swatch category={isIncome ? incomeCategory : s.category} size="sm" />
      <div className="src-who">
        <Link className="who" href={txLink({ q: s.key.toLowerCase(), direction: 'in' })}>{name}</Link>
        <div className="what">
          {meta}
          {s.detected ? <span className="src-tag" title="No salary chosen yet: the biggest income payer starts your month">detected</span> : null}
        </div>
      </div>
      <div className="src-kind">
        <Segmented label={`What ${name} pays you`} options={KINDS} value={picking ? 'none' : s.kind}
          onChange={(kind) => {
            if (kind === 'none') { if (s.kind !== 'none') setPicking(true); return; }
            setPicking(false);
            if (kind !== s.kind || s.detected) setKind(kind);
          }} />
        {picking || s.kind === 'none' ? (
          <div className="src-pot">
            <span className="sub">{picking ? 'Into which pot?' : 'Paid back into'}</span>
            <CategoryChip label={`Pot for money from ${name}`} includeNone={false} placeholder="Choose pot…"
              value={picking ? '' : s.category} onChange={(c) => { if (c && c !== incomeCategory) setKind('none', c); }} />
            {picking ? <button className="link-btn" type="button" onClick={() => setPicking(false)}>Cancel</button> : null}
          </div>
        ) : null}
      </div>
      {isIncome ? (
        <div className="src-payments">
          <button className={`btn btn-sm pay-toggle${open ? ' is-open' : ''}`} type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icon name="down" />
            {open ? 'Hide payments' : `Show ${plural(s.payments.length, 'payment')} · mark one-offs`}
            {!open && oneOffs ? <span className="src-tag">{`${oneOffs} one-off`}</span> : null}
          </button>
          {open ? <Payments payments={s.payments} /> : null}
        </div>
      ) : null}
    </li>
  );
}

// A bonus or holiday pay is still income that month, but shouldn't count as "usual" or start a month.
function Payments({ payments }) {
  const save = useSave();
  return (
    <div>
      <ul className="pay-list">
        {payments.map((p) => (
          <li key={p.id}>
            <span className="sub">{fmtDate(p.date)}</span>
            <Money cents={p.cents} sign className="is-in" />
            <label className="check">
              <input type="checkbox" checked={p.oneOff}
                onChange={(e) => save(() => api('/api/income/one-off', { method: 'POST', body: { id: p.id, oneOff: e.target.checked } }),
                  e.target.checked ? 'Marked as one-off: left out of averages and paydays' : 'Counts as regular income again')} />
              One-off
            </label>
          </li>
        ))}
      </ul>
      <p className="sub">One-offs (a bonus, holiday pay) don’t count toward your usual income.</p>
    </div>
  );
}

// ---------- the story so far: everything you've earned, per month or as a running total ----------

const r2 = (v) => Math.round(v * 100) / 100;
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2)) : 0;
};
const SERIES = [
  { key: 'salary', label: 'Salary', color: 'var(--in-fill)' },
  { key: 'other', label: 'Other income', color: 'color-mix(in srgb, var(--in-fill) 45%, var(--sheet))' },
  { key: 'oneOff', label: 'One-off', color: 'var(--need-fill)' },
];

function IncomeStory({ data }) {
  const [view, setView] = usePref('incomeView', 'months');
  const history = data.history;
  if (!history.length) return null;
  const total = history.reduce((s, m) => s + m.total, 0);
  const extras = history.reduce((s, m) => s + m.other + m.oneOff, 0);
  const done = history.filter((m) => !m.current);
  const typical = median(done.map((m) => m.salary + m.other));
  const best = [...history].sort((a, b) => b.total - a.total)[0];
  const used = SERIES.filter((se) => history.some((m) => m[se.key] > 0));

  return (
    <section className="panel income-story" aria-labelledby="story-h">
      <div className="story-top">
        <div className="story-head">
          <h2 id="story-h">{`Earned since ${fmtMonth(history[0].month)}`}</h2>
          <div className="story-total"><Money cents={total} /></div>
          <p className="story-fun">
            {`${plural(history.length, 'month')} of income`}
          </p>
        </div>
        <dl className="story-facts">
          <div><dt>Typical month</dt><dd><Money cents={typical} /></dd><span>without one-offs</span></div>
          <div><dt>Best month</dt><dd><Money cents={best.total} /></dd><span>{fmtMonth(best.month)}</span></div>
          <div><dt>Extras</dt><dd><Money cents={extras} /></dd><span>one-offs and other income</span></div>
        </dl>
      </div>
      <div className="trend-top story-controls">
        <Segmented label="Income chart" value={view === 'total' ? 'total' : 'months'}
          options={[['months', 'Per month'], ['total', 'Running total']]} onChange={setView} />
        {view === 'total' ? null : (
          <div className="legend">
            {used.map((se) => <span key={se.key}><i className="sq" style={{ background: se.color }} />{se.label}</span>)}
            <span><i className="dash" />{data.expectedMonthlyCents ? 'expected' : 'typical'}</span>
          </div>
        )}
      </div>
      {view === 'total' ? <RunningTotal history={history} /> : (
        <BarChart trend={history} month={history.at(-1).month} stacked
          series={used.map((se) => ({ label: se.label, color: se.color, value: (m) => m[se.key] }))}
          average={data.expectedMonthlyCents || typical} averageLabel={data.expectedMonthlyCents ? 'expected' : 'typical'}
          aria="Income per month"
          tip={(m) => [
            ...used.filter((se) => m[se.key] > 0).map((se) => ({ color: se.color, value: fmtMoney(m[se.key]), label: se.label })),
            { value: fmtMoney(m.total), label: m.current ? 'So far this month' : 'Total' },
          ]} />
      )}
    </section>
  );
}

// Everything earned so far, month by month, with a flag at every round milestone.
function RunningTotal({ history }) {
  const { tip, router } = useApp();
  const [ref, measured] = useWidth(600);
  const width = Math.max(280, measured);
  const height = 240;
  const m = { top: 34, right: 18, bottom: 24, left: 62 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  let run = 0;
  const points = history.map((h) => ({ ...h, sum: (run += h.total) }));
  const step = niceStep(run / 100) * 100;
  const top = Math.max(step, Math.ceil(run / step) * step);
  const x = (i) => r2(m.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW));
  const y = (v) => r2(m.top + innerH - (v / top) * innerH);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.sum)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  // The month each milestone was passed.
  const flags = ticks.slice(1).map((v) => ({ v, i: points.findIndex((p) => p.sum >= v) })).filter((f) => f.i >= 0);
  const label = (v) => `€${v >= 100000 * 100 ? `${v / 100000}k` : (v / 100).toLocaleString('nl-BE')}`;
  const short = (v) => (v % 100000 === 0 ? `€${v / 100000}k` : label(v));

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={`Running total of income, ${fmtMoney(run)} so far`}>
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? 'base' : 'grid'} x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} />
            <text x={m.left - 8} y={y(v) + 4} textAnchor="end">{label(v)}</text>
          </g>
        ))}
        <path className="story-area" d={area} />
        <path className="story-line" d={line} />
        {points.map((p, i) => (
          <g key={p.month}>
            <circle className="story-dot" cx={x(i)} cy={y(p.sum)} r={p.current ? 4.5 : 3} />
            <rect x={x(i) - innerW / points.length / 2} y={m.top} width={innerW / points.length} height={innerH} fill="transparent"
              tabIndex={0} role="link" aria-label={`${fmtMonth(p.month)}: ${fmtMoney(p.sum)} earned so far`}
              onClick={() => router.push(`/?month=${p.month}`)} onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/?month=${p.month}`); }}
              {...tipHandlers(tip, (e) => tip.show(e, fmtMonth(p.month), [
                { color: 'var(--in-fill)', value: fmtMoney(p.sum), label: 'Earned so far' },
                { value: `+${fmtMoney(p.total)}`, label: p.current ? 'This month so far' : 'That month' },
              ]))} />
            {(points.length <= 8 || i % 2 === (points.length - 1) % 2) ? (
              <text x={x(i)} y={height - 6} textAnchor="middle">{fmtMonth(p.month, 'short')}</text>
            ) : null}
          </g>
        ))}
        {flags.map((f) => {
          const w = short(f.v).length * 7 + 14;
          const left = x(f.i) - w >= m.left; // fly left, above the lower part of the rising line, unless near the axis
          return (
            <g key={f.v} className="story-flag" transform={`translate(${x(f.i)},${y(points[f.i].sum)})`} pointerEvents="none">
              <line x1="0" y1="0" x2="0" y2="-26" />
              <path d={left ? `M0,-26 h-${w} l5,8 l-5,8 h${w} z` : `M0,-26 h${w} l-5,8 l5,8 h-${w} z`} />
              <text x={left ? -w + 7 : 5} y="-14">{short(f.v)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
