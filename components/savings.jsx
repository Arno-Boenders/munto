'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { addDaysIso, fmtDate, fmtMoney, fmtMonth, fmtShort, niceStep, parseEuros, plural, tidy, txLink } from '@/lib/format.js';
import { balanceNow, DEFAULT_INFLATION, extraNeeded, monthlyDeposit, monthsToGoal, project, projectEach, returnOf } from '@/lib/savings.js';
import { api, useApp } from './app.jsx';
import { Icon, Jar, Money, SaveBar, Segmented, usePref, useWidth } from './ui.jsx';

const r2 = (v) => Math.round(v * 100) / 100;
const nameOf = (p) => p.name ?? (p.iban ? `${tidy(p.who)} · …${p.iban.slice(-4)}` : tidy(p.who));
const iconOf = (p) => (p.investing ? 'growth' : /revolut|wallet|cash/i.test(nameOf(p)) ? 'wallet' : 'bank');
const HORIZONS = [['1', '1 year'], ['5', '5 years'], ['10', '10 years'], ['20', '20 years']];
const RETURNS = [
  [0, '0% · cash'], [0.01, '1%'], [0.02, '2% · savings account'], [0.03, '3%'], [0.04, '4% · mixed fund'],
  [0.05, '5%'], [0.06, '6% · stocks (ETF)'], [0.07, '7%'], [0.08, '8%'],
];
const pct = (r) => `${Math.round(r * 1000) / 10}%`;
// "€ 98.400" without cents, for big round projections.
const round = (cents) => fmtMoney(Math.round(cents / 10000) * 10000).replace(/,00$/, '');

export function Savings({ data }) {
  const active = data.pots.filter((p) => p.plan?.mode !== 'off');
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Savings</h1>
        </div>
      </div>
      {data.pots.length ? (
        <>
          <Growth data={data} active={active} />
          <Goals data={data} active={active} />
          <Plan data={data} />
        </>
      ) : (
        <div className="empty"><Jar fill={0} className="jar-empty" /><strong>No savings yet</strong>Money you move to your own savings or investment accounts shows up here.</div>
      )}
    </div>
  );
}

// ---------- growth: the past, and a projection with a range ----------

function Growth({ data, active }) {
  const [horizonPref, setHorizon] = usePref('savingsHorizon', '10');
  const [realPref, setReal] = usePref('savingsReal', 'no');
  const [extra, setExtra] = useState(0);
  const years = Number(HORIZONS.some(([k]) => k === horizonPref) ? horizonPref : '10');
  const inflation = realPref === 'yes' ? DEFAULT_INFLATION : 0;
  const opts = { today: data.today, inflation };

  const future = useMemo(() => project(active, years * 12, { ...opts, extraCents: extra * 100 }), [active, years, inflation, extra]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => (extra ? project(active, years * 12, opts) : future), [active, years, inflation, extra, future]); // eslint-disable-line react-hooks/exhaustive-deps
  const past = useMemo(() => history(data, active), [data, active]);

  const now = future[0].mid;
  const end = future.at(-1);
  const monthly = active.reduce((s, p) => s + monthlyDeposit(p), 0);
  // Balances count as known when every account that matters has one (near-empty ones don't need it).
  const known = active.filter((p) => p.plan || p.net >= 1000).every((p) => balanceNow(p, data.today).known);
  const planned = active.filter((p) => p.plan?.mode === 'fixed');
  const plannedTotal = planned.reduce((s, p) => s + p.plan.monthlyCents, 0);
  const savedThisMonth = planned.reduce((s, p) => s + Math.max(0, p.thisMonth), 0);

  return (
    <section className="panel savings-hero" aria-labelledby="growth-h">
      <div className="story-top">
        <div className="story-head">
          <h2 id="growth-h">{known ? 'In your savings today' : `Put aside since ${fmtMonth(data.months[0])}`}</h2>
          <div className="story-total"><Money cents={now} /></div>
          <p className="story-fun">
            {known ? `across ${plural(active.length, 'account')}` : <>{'Add today’s balance per account below to start from what’s really there.'}</>}
          </p>
        </div>
        <dl className="story-facts">
          <div><dt>A month</dt><dd><Money cents={monthly} /></dd><span>your plan, all accounts</span></div>
          {plannedTotal ? (
            <div>
              <dt>This month</dt>
              <dd className={savedThisMonth >= plannedTotal ? 'is-in' : ''}><Money cents={savedThisMonth} /></dd>
              <span>{savedThisMonth >= plannedTotal ? `plan of ${fmtMoney(plannedTotal)} done ✓` : `of ${fmtMoney(plannedTotal)} planned`}</span>
            </div>
          ) : null}
          <div><dt>{`In ${plural(years, 'year')}`}</dt><dd className="is-in">{round(end.mid)}</dd><span>{`${round(end.low)} – ${round(end.high)}`}</span></div>
        </dl>
      </div>

      <div className="story-controls">
        <Segmented label="How far ahead" options={HORIZONS} value={String(years)} onChange={setHorizon} />
        <div className="growth-toggles">
          <label className="check"><input type="checkbox" checked={realPref === 'yes'} onChange={(e) => setReal(e.target.checked ? 'yes' : 'no')} />In today’s money</label>
          <div className="legend">
            <span><i />so far</span><span><i className="dash" />expected</span><span><i className="sq band-sq" />likely range</span>
          </div>
        </div>
      </div>

      <GrowthChart past={past} future={future} base={extra ? base : null} months={data.months} today={data.today}
        goals={data.goals.filter((g) => !g.accounts.length).map((g) => ({ name: g.name, cents: inflation ? null : g.targetCents })).filter((g) => g.cents)} />

      <div className="what-if">
        <label htmlFor="what-if">
          <span className="stamp">What if</span>
          <span>{extra === 0 ? 'I saved the same' : `I saved ${fmtMoney(Math.abs(extra) * 100).replace(/,00$/, '')} ${extra > 0 ? 'more' : 'less'} a month`}</span>
        </label>
        <input id="what-if" type="range" min={-Math.floor(monthly / 100 / 25) * 25} max={1000} step={25} value={extra}
          onChange={(e) => setExtra(Number(e.target.value))} />
        <p className="what-if-result" aria-live="polite">
          {extra === 0 ? 'Drag to see what saving more (or less) would do.'
            : <>{`In ${plural(years, 'year')}: `}<b className={extra > 0 ? 'is-in' : 'is-over'}>{`${extra > 0 ? '+' : '−'}${round(Math.abs(end.mid - base.at(-1).mid))}`}</b>{` (${round(end.mid)} instead of ${round(base.at(-1).mid)})`}</>}
          {extra !== 0 ? <button className="link-btn" type="button" onClick={() => setExtra(0)}>Reset</button> : null}
        </p>
      </div>

      <p className="sub growth-small">
        A projection, not a promise.{inflation ? ` ${pct(inflation)} inflation a year.` : ''}
      </p>
    </section>
  );
}

// The balance at the end of each past month: today's balance minus what was moved in after that month.
function history(data, active) {
  return data.months.map((m, i) => {
    let total = 0;
    for (const p of active) {
      const nowCents = balanceNow(p, data.today).cents;
      const after = data.months.slice(i + 1).reduce((s, mm) => s + (p.byMonth[mm] ?? 0), 0);
      total += Math.max(0, nowCents - after);
    }
    return { month: m, cents: total };
  });
}

function GrowthChart({ past, future, base, months, today, goals = [] }) {
  const { tip } = useApp();
  const [ref, measured] = useWidth(700);
  const [hover, setHover] = useState(null);
  const width = Math.max(280, measured);
  const height = 260;
  const m = { top: 14, right: 14, bottom: 26, left: 66 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  // One time axis in months: the past (P months, ending today) then the future.
  const P = past.length - 1;
  const F = future.length - 1;
  const total = Math.max(1, P + F);
  const x = (t) => r2(m.left + ((t + P) / total) * innerW); // t: months from today (negative = past)
  const hi = Math.max(1, ...future.map((f) => f.high), ...past.map((p) => p.cents), ...goals.map((g) => g.cents * 1.05));
  const step = niceStep(hi / 100, 4) * 100;
  const top = Math.ceil(hi / step) * step;
  const y = (v) => r2(m.top + innerH - (Math.max(0, v) / top) * innerH);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const line = (pts) => pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t)},${y(v)}`).join(' ');
  const pastLine = line(past.map((p, i) => [i - P, p.cents]));
  const midLine = line(future.map((f) => [f.n, f.mid]));
  const baseLine = base ? line(base.map((f) => [f.n, f.mid])) : null;
  const band = `${line(future.map((f) => [f.n, f.high]))} ${future.slice().reverse().map((f) => `L${x(f.n)},${y(f.low)}`).join(' ')} Z`;
  // Year labels on the future side; month labels when looking only one year ahead.
  const years = F / 12;
  const labelEvery = years <= 1 ? 3 : years <= 5 ? 12 : years <= 10 ? 24 : 48;
  const thisYear = Number(today.slice(0, 4));
  const label = (n) => (years <= 1 ? fmtMonth(addDaysIso(today, n * 30.44).slice(0, 7), 'short') : String(thisYear + n / 12));
  const ax = axis(top);

  function move(ev) {
    const r = ev.currentTarget.ownerSVGElement.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width;
    const t = Math.round(((px - m.left) / innerW) * total) - P;
    const tt = Math.max(-P, Math.min(F, t));
    setHover(tt);
    if (tt <= 0) {
      const p = past[tt + P];
      tip.show(ev, fmtMonth(p.month), [{ color: 'var(--in-fill)', value: fmtMoney(p.cents), label: 'Saved by then' }]);
    } else {
      const f = future[tt];
      const when = fmtMonth(addDaysIso(today, tt * 30.44).slice(0, 7));
      tip.show(ev, `${when} · in ${tt < 12 ? plural(tt, 'month') : `${Math.round((tt / 12) * 10) / 10} years`}`, [
        { color: 'var(--in-fill)', value: fmtMoney(f.mid), label: 'Expected' },
        { value: `${round(f.low)} – ${round(f.high)}`, label: 'Likely range' },
        { value: fmtMoney(f.deposited), label: 'Put in' },
        { value: fmtMoney(Math.max(0, f.mid - f.deposited)), label: 'Growth' },
      ]);
    }
  }

  return (
    <div className="chart growth-chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img"
        aria-label={`Savings: ${fmtMoney(future[0].mid)} today, expected ${fmtMoney(future.at(-1).mid)} in ${plural(Math.round(years), 'year')}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? 'base' : 'grid'} x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} />
            <text x={m.left - 8} y={y(v) + 4} textAnchor="end">{ax(v)}</text>
          </g>
        ))}
        {goals.map((g) => (
          <g key={g.name} className="growth-goal" pointerEvents="none">
            <line x1={m.left} x2={width - m.right} y1={y(g.cents)} y2={y(g.cents)} />
            <text x={width - m.right - 4} y={y(g.cents) - 5} textAnchor="end">{`${g.name} · ${round(g.cents)}`}</text>
          </g>
        ))}
        <path className="growth-band" d={band} />
        {baseLine ? <path className="growth-base" d={baseLine} /> : null}
        <path className="growth-mid" d={midLine} />
        <path className="story-line" d={pastLine} />
        <line className="growth-now" x1={x(0)} x2={x(0)} y1={m.top} y2={m.top + innerH} />
        <text className="growth-now-label" x={x(0) + 6} y={m.top + 10}>today</text>
        <circle className="story-dot" cx={x(0)} cy={y(future[0].mid)} r={4.5} />
        {P > 0 ? <text x={x(-P)} y={height - 6} textAnchor="start">{fmtMonth(months[0], 'short')}</text> : null}
        {future.filter((f) => f.n > 0 && f.n % labelEvery === 0).map((f) => (
          <text key={f.n} x={x(f.n)} y={height - 6} textAnchor={f.n === F ? 'end' : 'middle'}>{label(f.n)}</text>
        ))}
        {hover != null ? <line className="growth-hover" x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + innerH} /> : null}
        <rect x={m.left} y={m.top} width={innerW} height={innerH} fill="transparent"
          data-tip="" onPointerDown={move} onPointerMove={move} onPointerLeave={() => { setHover(null); tip.hide(); }} />
      </svg>
    </div>
  );
}

// Axis labels: € 40.000, € 120k, € 1,2M.
const axis = (top) => (v) => {
  const e = v / 100;
  if (e === 0) return '€0';
  if (top >= 100_000_000 && e >= 1_000_000) return `€${(e / 1_000_000).toLocaleString('nl-BE', { maximumFractionDigits: 1 })}M`;
  if (top >= 10_000_000) return `€${Math.round(e / 1000)}k`;
  return `€${e.toLocaleString('nl-BE')}`;
};

// ---------- the plan: one row per savings account, saved together ----------

const toText = (c) => (c == null ? '' : (c / 100).toLocaleString('nl-BE', { minimumFractionDigits: c % 100 ? 2 : 0 }));
// What a row's fields start as: the saved plan, or a sensible default.
const draftOf = (p) => ({
  mode: p.plan?.mode ?? 'average',
  monthly: toText(p.plan?.monthlyCents ?? (p.average > 0 ? Math.round(p.average / 500) * 500 : null)),
  ret: returnOf(p),
  balance: toText(p.plan?.balanceCents),
});
const same = (a, b) => a.mode === b.mode && a.ret === b.ret && a.balance.trim() === b.balance.trim() && (a.mode !== 'fixed' || a.monthly.trim() === b.monthly.trim());

function Plan({ data }) {
  const { toast, refresh } = useApp();
  const [years] = usePref('savingsHorizon', '10');
  const initial = useMemo(() => Object.fromEntries(data.pots.map((p) => [p.key, draftOf(p)])), [data]);
  const [drafts, setDrafts] = useState(initial);
  useEffect(() => { setDrafts(initial); }, [initial]);
  const [saving, setSaving] = useState(false);
  const [showSmall, setShowSmall] = useState(false);

  // The pots as they'd be with the unsaved changes, so the "in N years" numbers follow your edits.
  const withDraft = (p) => {
    const d = drafts[p.key];
    return { ...p, plan: { mode: d.mode, monthlyCents: parseEuros(d.monthly) ?? 0, annualReturn: d.ret, balanceCents: d.balance.trim() ? parseEuros(d.balance) : null, balanceDate: p.plan?.balanceDate ?? data.today } };
  };
  const each = useMemo(() => new Map(projectEach(data.pots.map(withDraft), Number(years) * 12, { today: data.today }).map((e) => [e.key, e])), [data, years, drafts]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = data.pots.filter((p) => !same(drafts[p.key], initial[p.key]));
  const problems = changed.map((p) => {
    const d = drafts[p.key];
    if (d.mode === 'fixed' && !(parseEuros(d.monthly) > 0)) return `${nameOf(p)}: type an amount a month`;
    if (d.balance.trim() && parseEuros(d.balance) == null) return `${nameOf(p)}: type the balance, like 12.500`;
    return null;
  }).filter(Boolean);

  async function saveAll() {
    const plans = {};
    for (const p of changed) {
      const d = drafts[p.key];
      const balanceCents = d.balance.trim() ? parseEuros(d.balance) : null;
      plans[p.key] = {
        mode: d.mode,
        monthlyCents: d.mode === 'fixed' ? parseEuros(d.monthly) : undefined,
        annualReturn: d.ret,
        balanceCents,
        balanceDate: balanceCents != null && balanceCents === p.plan?.balanceCents ? p.plan.balanceDate : data.today,
      };
    }
    setSaving(true);
    try {
      await api('/api/savings/plans', { method: 'POST', body: { plans } });
      toast(`Saved the plan for ${plural(changed.length, 'account')}`);
      refresh();
    } catch (err) { toast(err.message); }
    setSaving(false);
  }

  const off = data.pots.filter((p) => drafts[p.key]?.mode === 'off');
  // Accounts with (almost) nothing in them and no plan go under a fold.
  const isSmall = (p) => !p.plan && p.net < 1000 && p.average <= 0;
  const main = data.pots.filter((p) => !isSmall(p));
  const small = data.pots.filter(isSmall);
  const row = (p) => (
    <PlanRow key={p.key} pot={p} draft={drafts[p.key]} changed={changed.includes(p)} inYears={Number(years)} projected={each.get(p.key)}
      onChange={(patch) => setDrafts((x) => ({ ...x, [p.key]: { ...x[p.key], ...patch } }))} />
  );

  return (
    <section className={`panel${changed.length ? ' has-savebar' : ''}`} aria-labelledby="plan-h" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <h2 id="plan-h">Your plan</h2>
        <span className="sub">{`${plural(data.pots.length - off.length, 'account')} in the plan`}</span>
      </div>
      <p className="income-explain">Add each balance from your bank app, so the projection starts from what’s really there.</p>
      <ul className="plan-list">{main.map(row)}</ul>
      {small.length ? (
        <div className="plan-small">
          <button className="btn btn-sm pay-toggle" type="button" aria-expanded={showSmall} onClick={() => setShowSmall((v) => !v)}>
            <Icon name="down" />{showSmall ? 'Hide small accounts' : `${plural(small.length, 'small or empty account')}`}
          </button>
          {showSmall ? <ul className="plan-list">{small.map(row)}</ul> : null}
        </div>
      ) : null}
      {changed.length ? (
        <SaveBar label={problems[0] ?? `${plural(changed.length, 'account')} changed`}
          onUndo={() => setDrafts(initial)} onSave={saveAll} busy={saving} blocked={problems.length ? 'Fix the amounts first' : null} />
      ) : null}
    </section>
  );
}

function PlanRow({ pot: p, draft, changed, inYears, projected, onChange }) {
  const name = nameOf(p);
  const isOff = draft.mode === 'off';
  const avgText = p.average > 0 ? `usually ${fmtMoney(p.average)} a month` : p.average < 0 ? `on average ${fmtMoney(-p.average)} a month taken out` : 'nothing put in lately';
  return (
    <li className={`plan-row${isOff ? ' is-off' : ''}${changed ? ' is-changed' : ''}`}>
      <span className="swatch sm" style={{ '--c': isOff ? 'var(--muted)' : 'var(--in-fill)' }}><Icon name={iconOf(p)} /></span>
      <div className="plan-who">
        <Link className="who" href={txLink(p.iban ? { iban: p.iban } : { q: p.who.toLowerCase() })}>{name}</Link>
        <div className="what">{`${fmtMoney(Math.max(0, p.net))} put in since ${fmtDate(p.firstDate)} · ${avgText}`}</div>
        {!isOff && projected ? (
          <div className="plan-future">{'In '}{plural(inYears, 'year')}{': about '}<b>{round(projected.cents)}</b>{` at ${pct(draft.ret)} a year`}</div>
        ) : null}
      </div>
      <div className="plan-controls">
        <Segmented label={`Plan for ${name}`} value={draft.mode}
          options={[['fixed', 'Fixed'], ['average', 'Average'], ['off', 'Not savings']]} onChange={(mode) => onChange({ mode })} />
        {isOff ? null : (
          <div className="plan-fields">
            {draft.mode === 'fixed' ? (
              <label className="money-input">
                <span aria-hidden="true">€</span>
                <input type="text" inputMode="decimal" placeholder="300" aria-label={`Put aside in ${name} a month`} value={draft.monthly} onChange={(e) => onChange({ monthly: e.target.value })} />
                <span className="per">a month</span>
              </label>
            ) : null}
            <label className="field">
              <span>Return</span>
              <select aria-label={`Expected return for ${name}`} value={String(draft.ret)} onChange={(e) => onChange({ ret: Number(e.target.value) })}>
                {(RETURNS.some(([v]) => v === draft.ret) ? RETURNS : [...RETURNS, [draft.ret, pct(draft.ret)]]).map(([v, l]) => <option key={v} value={String(v)}>{`${l} a year`}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Balance</span>
              <span className="money-input">
                <span aria-hidden="true">€</span>
                <input type="text" inputMode="decimal" placeholder="today" aria-label={`Balance of ${name} today`} value={draft.balance} onChange={(e) => onChange({ balance: e.target.value })} />
                {p.plan?.balanceCents != null ? <span className="per">{`on ${fmtShort(p.plan.balanceDate)}`}</span> : null}
              </span>
            </label>
          </div>
        )}
      </div>
    </li>
  );
}

// ---------- goals ----------

const monthName = (ym) => fmtMonth(ym);
const inWords = (n) => (n < 12 ? plural(n, 'month') : n % 12 === 0 ? plural(n / 12, 'year') : `${plural(Math.floor(n / 12), 'year')} ${plural(n % 12, 'month')}`);
const addMonths = (iso, n) => { const d = new Date(iso.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const monthsUntil = (today, ym) => { const [y1, m1] = today.split('-').map(Number); const [y2, m2] = ym.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };

function Goals({ data, active }) {
  const [form, setForm] = useState(null);
  return (
    <section className="panel goals" aria-labelledby="goals-h" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <div>
          <h2 id="goals-h">Goals</h2>
        </div>
        {!form ? <button className="btn btn-sm" type="button" onClick={() => setForm({ id: null, name: '', target: '', byDate: '', accounts: [] })}>Add a goal</button> : null}
      </div>
      {form ? <GoalForm draft={form} setDraft={setForm} pots={active} onDone={() => setForm(null)} /> : null}
      {data.goals.length ? (
        <ul className="goal-list">
          {data.goals.map((g) => <Goal key={g.id} g={g} data={data} active={active}
            onEdit={() => setForm({ id: g.id, name: g.name, target: (g.targetCents / 100).toLocaleString('nl-BE'), byDate: g.byDate ?? '', accounts: g.accounts })} />)}
        </ul>
      ) : !form ? <p className="empty-line">No goals yet.</p> : null}
    </section>
  );
}

function Goal({ g, data, active, onEdit }) {
  const { toast, refresh } = useApp();
  const pots = g.accounts.length ? active.filter((p) => g.accounts.includes(p.key)) : active;
  const now = pots.reduce((t, p) => t + balanceNow(p, data.today).cents, 0);
  const pct = Math.min(100, Math.round((now / g.targetCents) * 100));
  const reached = now >= g.targetCents;
  const n = reached ? 0 : monthsToGoal(pots, g.targetCents, { today: data.today });
  const left = g.byDate ? monthsUntil(data.today, g.byDate) : null;
  const extra = !reached && g.byDate && left > 0 ? extraNeeded(pots, g.targetCents, left, { today: data.today }) : null;
  const names = g.accounts.length ? pots.map(nameOf).join(', ') : 'all accounts in your plan';
  async function remove() {
    if (!confirm(`Remove the goal “${g.name}”?`)) return;
    try { await api(`/api/savings/goals/${g.id}`, { method: 'DELETE', body: {} }); toast('Goal removed'); refresh(); } catch (err) { toast(err.message); }
  }
  return (
    <li className={`goal${reached ? ' is-reached' : ''}`}>
      <div className="goal-head">
        <b className="goal-name"><Jar fill={pct / 100} className="jar-mini" />{g.name}</b>
        <span><Money cents={now} />{' of '}<Money cents={g.targetCents} /></span>
      </div>
      <p className="goal-status">
        {reached ? <b className="is-in">Reached ✓</b>
          : n == null ? 'Not within 50 years at this pace.'
          : <>{'At your plan: around '}<b>{monthName(addMonths(data.today, n))}</b>{` (in ${inWords(n)})`}</>}
        {g.byDate && !reached ? (
          extra === 0 ? <span className="is-in">{` · on track for ${monthName(g.byDate)} ✓`}</span>
            : extra ? <span className="is-over">{` · ${fmtMoney(extra).replace(/,00$/, '')} more a month to make it by ${monthName(g.byDate)}`}</span> : null
        ) : null}
      </p>
      <p className="goal-meta">
        {`${pct}% · counts ${names}`}
        <button className="link-btn" type="button" onClick={onEdit}>Edit</button>
        <button className="link-btn is-danger" type="button" onClick={remove}>Remove</button>
      </p>
    </li>
  );
}

function GoalForm({ draft, setDraft, pots, onDone }) {
  const { toast, refresh } = useApp();
  const [error, setError] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  async function save(e) {
    e.preventDefault();
    const targetCents = parseEuros(draft.target);
    if (!draft.name.trim()) { setError('Give it a name, like Emergency fund'); return; }
    if (!(targetCents > 0)) { setError('Type how much you want to have, like 10.000'); return; }
    try {
      await api('/api/savings/goals', { method: 'POST', body: { id: draft.id, name: draft.name, targetCents, byDate: draft.byDate || null, accounts: draft.accounts } });
      toast(draft.id ? 'Goal updated' : `Goal added: ${draft.name}`);
      onDone();
      refresh();
    } catch (err) { setError(err.message); }
  }
  const toggle = (key) => set({ accounts: draft.accounts.includes(key) ? draft.accounts.filter((k) => k !== key) : [...draft.accounts, key] });
  return (
    <form className="goal-form" onSubmit={save}>
      <div className="subs-fields">
        <label className="field-col"><span>Goal</span><input type="text" placeholder="Emergency fund" value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></label>
        <label className="field-col"><span>Amount</span>
          <span className="money-input"><span aria-hidden="true">€</span><input type="text" inputMode="decimal" placeholder="10.000" value={draft.target} onChange={(e) => set({ target: e.target.value })} aria-label="Goal amount" /></span></label>
        <label className="field-col"><span>By (optional)</span><input type="month" value={draft.byDate} onChange={(e) => set({ byDate: e.target.value })} /></label>
      </div>
      <div className="field-col goal-accounts">
        <span>Counts toward it</span>
        <div>
          <label className="check"><input type="checkbox" checked={!draft.accounts.length} onChange={() => set({ accounts: [] })} />All accounts</label>
          {pots.map((p) => <label className="check" key={p.key}><input type="checkbox" checked={draft.accounts.includes(p.key)} onChange={() => toggle(p.key)} />{nameOf(p)}</label>)}
        </div>
      </div>
      {error ? <div className="error-text" role="alert">{error}</div> : null}
      <div className="inline-form">
        <button className="btn btn-ink" type="submit"><Icon name="check" />{draft.id ? 'Save goal' : 'Add goal'}</button>
        <button className="btn btn-ghost" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
