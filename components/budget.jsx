'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { look } from '@/lib/look.js';
import { fmtMoney, fmtMonth, parseEuros, plural, txLink } from '@/lib/format.js';
import { api, tipHandlers, useApp } from './app.jsx';
import { Icon, Jar, Money, SaveBar, Swatch, useWidth } from './ui.jsx';
import { fitToRule } from '@/lib/budget.js';
import { Funds } from './funds.jsx';
import { LookBack } from './lookback.jsx';

const KIND = {
  fixed: ['Fixed', 'About the same every month'],
  flexible: ['Flexible', 'Changes from month to month'],
  irregular: ['Irregular', 'Big now and then: put aside monthly'],
};
const toText = (c) => (c == null ? '' : (c / 100).toLocaleString('nl-BE', { minimumFractionDigits: c % 100 ? 2 : 0 }));
const whole = (cents) => fmtMoney(Math.round(cents / 100) * 100).replace(/,00$/, '');

export function Budget({ data }) {
  const { config, toast, refresh } = useApp();
  const aiName = config.aiName ?? 'AI'; // whichever AI you chose under Settings
  const saved = Object.fromEntries(data.pots.map((e) => [e.category, toText(e.budget)]));
  const savedGroups = Object.fromEntries(data.pots.map((e) => [e.category, e.group]));
  const [values, setValues] = useState(saved);
  const [groups, setGroups] = useState(savedGroups);
  const [rule, setRule] = useState(data.rule);
  useEffect(() => { setValues(saved); setGroups(savedGroups); setRule(data.rule); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ai, setAi] = useState(null); // { budgets: { category: { cents, reason } }, summary }
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const cents = (category) => (values[category]?.trim() ? parseEuros(values[category]) : null);
  const dirty = data.pots.filter((e) => (cents(e.category) ?? null) !== (e.budget ?? null));
  const regrouped = data.pots.filter((e) => groups[e.category] !== e.group);
  const ruleChanged = rule !== data.rule;
  const changes = dirty.length + regrouped.length + (ruleChanged ? 1 : 0);
  const invalid = data.pots.filter((e) => values[e.category]?.trim() && cents(e.category) == null);
  const total = data.pots.reduce((s, e) => s + (cents(e.category) ?? 0), 0);
  const hasBudget = data.pots.some((e) => e.budget != null);
  const ruled = useMemo(() => fitToRule(data, groups, rule), [data, groups, rule]);
  const suggestionOf = (e) => (ai?.budgets[e.category] ? { cents: ai.budgets[e.category].cents, reason: ai.budgets[e.category].reason, ai: true } : { ...ruled[e.category], ai: false });

  async function askClaude() {
    setAiBusy(true); setAiError(null);
    try { setAi(await api('/api/budget/suggest', { method: 'POST', body: { groups, rule } })); } catch (err) { setAiError(err.message); }
    setAiBusy(false);
  }
  const fillAll = () => setValues(Object.fromEntries(data.pots.map((e) => [e.category, toText(suggestionOf(e).cents)])));

  async function save(next = values) {
    const body = {};
    for (const e of data.pots) {
      const v = next[e.category]?.trim() ? parseEuros(next[e.category]) : null;
      if ((v ?? null) !== (e.budget ?? null)) body[e.category] = v;
    }
    if (!changes) return;
    setSaving(true);
    try {
      await api('/api/budget', {
        method: 'POST',
        body: { budgets: body, groups: Object.fromEntries(regrouped.map((e) => [e.category, groups[e.category]])), rule: ruleChanged ? rule : undefined },
      });
      toast(hasBudget ? 'Budget saved' : 'Budget saved · your pots now count down from it');
      refresh();
    } catch (err) { toast(err.message); }
    setSaving(false);
  }

  const range = data.months.length ? `${fmtMonth(data.months[0], 'short')} – ${fmtMonth(data.months.at(-1), 'short')}` : '';
  const month = data.current ? fmtMonth(data.current.month, 'long').split(' ')[0] : null;

  const saveBar = changes ? (
    <SaveBar label={[
      dirty.length ? `${plural(dirty.length, 'budget')} changed · ${whole(total)} a month in total` : null,
      regrouped.length ? `${plural(regrouped.length, 'pot')} moved between needs and wants` : null,
      ruleChanged ? `rule ${rule.replace(/-/g, '/')}` : null,
    ].filter(Boolean).join(' · ')}
      onUndo={() => { setValues(saved); setGroups(savedGroups); setRule(data.rule); }} onSave={() => save()} busy={saving} blocked={invalid.length ? 'Fix the amounts first' : null} />
  ) : null;

  if (!editing) {
    return (
      <div className={changes ? 'has-savebar' : ''}>
        <div className="page-head">
          <div>
            <h1>Budget</h1>
            {month ? <p className="sub" style={{ marginTop: 4 }}>{month}</p> : null}
          </div>
          {hasBudget ? <button className="btn" type="button" onClick={() => setEditing(true)}>Edit budget</button> : null}
        </div>
        <LookBack lb={data.lookback} />
        <ThisMonth data={data} onEdit={() => setEditing(true)} budgetOf={(e) => cents(e.category) ?? 0}
          onBudget={(category, c) => setValues((v) => ({ ...v, [category]: toText(c) }))} />
        {data.funds.length ? <Funds data={data} budgetOf={cents} /> : null}
        {saveBar}
      </div>
    );
  }

  return (
    <div className={changes ? 'has-savebar' : ''}>
      <div className="page-head">
        <div>
          <h1>Edit budget</h1>
          <p className="sub" style={{ marginTop: 4 }}>
            {`Suggestions are based on ${range}`}
          </p>
        </div>
        <button className="btn" type="button" disabled={changes > 0} title={changes ? 'Save or undo your changes first' : undefined}
          onClick={() => setEditing(false)}>Done</button>
      </div>

      <section className="panel budget-panel" aria-labelledby="env-budget-h">
        <div className="panel-head budget-tools">
          <div>
            <h2 id="env-budget-h">Pots</h2>
          </div>
          <div className="budget-ai-actions">
            {config.aiConfigured ? (
              <button className={`btn btn-sm${ai ? '' : ' btn-need'}${aiBusy ? ' is-busy' : ''}`} type="button" onClick={askClaude} disabled={aiBusy}
                title="Only monthly totals per pot, your income and savings plan are sent">
                <Icon name="sparkle" />{aiBusy ? `${aiName} is thinking…` : ai ? `Ask ${aiName} again` : `Suggest with ${aiName}`}
              </button>
            ) : null}
            <button className="btn btn-sm" type="button" onClick={fillAll} disabled={aiBusy}><Icon name="check" />{ai ? `Use all of ${aiName}’s` : 'Fill in all suggestions'}</button>
          </div>
        </div>
        {ai || aiError ? (
          <p className={`budget-ai-note${aiError ? ' is-error' : ''}`}><Icon name="sparkle" />{aiError ? `${aiName} isn’t available right now: ${aiError}` : ai.summary}</p>
        ) : null}
        <div className="budget-head" aria-hidden="true">
          <span>Pot</span><span>History</span><span>Typical</span><span>Suggested</span><span>Budget a month</span>
        </div>
        <ul className="budget-list">
          {data.pots.map((e) => (
            <Row key={e.category} e={e} months={data.months} fund={data.funds.find((f) => f.category === e.category)} value={values[e.category] ?? ''} suggestion={suggestionOf(e)}
              onChange={(v) => setValues((x) => ({ ...x, [e.category]: v }))} invalid={invalid.includes(e)}
              group={groups[e.category]} onGroup={(g) => setGroups((x) => ({ ...x, [e.category]: g }))} />
          ))}
        </ul>
      </section>

      <Plan data={data} rule={rule} setRule={setRule} groups={groups} budgetOf={cents} total={total}
        onTrimWants={() => setValues((v) => ({ ...v, ...Object.fromEntries(data.pots
          .filter((e) => groups[e.category] === 'wants' && e.kind !== 'fixed').map((e) => [e.category, toText(ruled[e.category].cents)])) }))} />

      <Funds data={data} budgetOf={cents} />

      {saveBar}
    </div>
  );
}

// ---------- this month: what's left, and each pot against its budget ----------

// Where an even pace would be today, as a share of the month (0–1).
function monthPace(current, daysLeft) {
  if (!current || daysLeft == null) return null;
  const elapsed = Math.max(1, Math.round((Date.now() - new Date(`${current.start}T00:00:00`)) / 86400000) + 1);
  return Math.min(1, elapsed / (elapsed + daysLeft));
}

function ThisMonth({ data, onEdit, budgetOf, onBudget }) {
  const pace = monthPace(data.current, data.daysLeft);
  // A €0 budget only shows once something was spent in it.
  const budgeted = data.pots.filter((e) => e.budget > 0 || (e.budget != null && e.spentNow > 0));
  const bills = budgeted.filter((e) => e.kind === 'fixed');
  const spending = budgeted.filter((e) => e.kind !== 'fixed');
  const unbudgeted = data.pots.filter((e) => e.budget == null && (e.spentNow > 0 || e.average > 0));
  const fundOf = (e) => data.funds.find((f) => f.category === e.category);

  if (!budgeted.length) {
    return (
      <section className="month-hero is-empty">
        <Jar fill={0} className="jar-empty" />
        <h2>No budget yet</h2>
        <p>Munto suggests one from what you spent in the last months. You can change every amount.</p>
        <button className="btn btn-ink" type="button" onClick={onEdit}>Set a budget</button>
      </section>
    );
  }

  const total = spending.reduce((t, e) => t + budgetOf(e), 0);
  const spent = spending.reduce((t, e) => t + e.spentNow, 0);
  const left = total - spent;
  const perDay = left > 0 && data.daysLeft > 0 ? left / data.daysLeft : null;
  return (
    <>
      <section className="month-hero" aria-labelledby="left-h">
        <p className="month-hero-label" id="left-h">{left >= 0 ? 'Left to spend' : 'Over budget'}</p>
        <p className={`month-hero-num${left < 0 ? ' is-over' : ''}`}><Money cents={Math.abs(left)} /></p>
        <p className="month-hero-sub">
          {`${whole(spent)} of ${whole(total)} spent`}
          {data.daysLeft != null ? ` · ${plural(data.daysLeft, 'day')} to go` : ''}
          {perDay ? ` · about ${whole(perDay)} a day` : ''}
        </p>
        <Progress spent={spent} budget={total} pace={pace} big />
      </section>

      {spending.length ? (
        <section className="track" aria-labelledby="track-spend-h">
          <h2 id="track-spend-h">Spending</h2>
          <ul className="track-list">{spending.map((e) => <TrackRow key={e.category} e={e} budget={budgetOf(e)} fund={fundOf(e)} onBudget={(c) => onBudget(e.category, c)} />)}</ul>
        </section>
      ) : null}

      {bills.length ? (
        <section className="track" aria-labelledby="track-bills-h">
          <h2 id="track-bills-h">Bills</h2>
          <ul className="track-list is-bills">{bills.map((e) => <BillRow key={e.category} e={e} />)}</ul>
        </section>
      ) : null}

      {unbudgeted.length ? (
        <p className="track-unbudgeted">
          {`No budget for ${list(unbudgeted.slice(0, 4).map((e) => look(e.category).label))}${unbudgeted.length > 4 ? ` and ${unbudgeted.length - 4} more` : ''}. `}
          <button className="link-btn" type="button" onClick={onEdit}>Set one</button>
        </p>
      ) : null}
    </>
  );
}

// A bar that fills as the money goes, with a tick where an even pace would be today. Red past the budget.
function Progress({ spent, budget, pace, big = false }) {
  const share = budget > 0 ? spent / budget : 1;
  return (
    <div className={`progress${big ? ' is-big' : ''}${share > 1 ? ' is-over' : ''}`} aria-hidden="true">
      <span className="progress-fill" style={{ width: `${Math.min(100, share * 100)}%` }} />
      {pace != null ? <i className="progress-today" style={{ left: `${pace * 100}%` }}>{big ? <span>today</span> : null}</i> : null}
    </div>
  );
}

// How far a row's line runs: past the saved budget, what went out and the usual month, so there's room to
// raise the budget. Taken from the saved budget, so the line doesn't stretch while you drag.
const SLIDER_STEP = 500;
function sliderScale(e) {
  const most = Math.max(e.budget * 1.6, e.spentNow * 1.15, (e.average ?? 0) * 1.3, 5000);
  return Math.ceil(most / 1000) * 1000;
}

// The budget line on a row: the fill is what went out, the tinted stretch ends at the budget, marked by a line
// at rest and by the knob on hover.
// Drag the knob, or use the arrow keys on it, to change the budget; the Save bar keeps it. No pace tick here:
// it's a share of the budget, so it would creep along behind the knob. The month's bar at the top has it.
function BudgetSlider({ label, spent, budget, scale, onChange }) {
  const at = (c) => `${Math.min(100, (c / scale) * 100)}%`;
  return (
    <div className={`progress is-slider${spent > budget ? ' is-over' : ''}`}>
      <span className="progress-room" style={{ width: at(budget) }} />
      <span className="progress-fill" style={{ width: at(spent) }} />
      <i className="progress-budget" style={{ left: at(budget) }} />
      <input type="range" min="0" max={scale} step={SLIDER_STEP} value={Math.min(budget, scale)}
        aria-label={`Budget for ${label}`} aria-valuetext={whole(budget)} onChange={(ev) => onChange(Number(ev.target.value))} />
    </div>
  );
}

function TrackRow({ e, budget, fund, onBudget }) {
  const l = look(e.category);
  const left = budget - e.spentNow;
  return (
    <li className="track-row" style={{ '--c': l.color }}>
      <Link className="track-name" href={txLink({ category: e.category })}><Swatch category={e.category} size="sm" /><span>{l.label}</span></Link>
      <span className="track-amounts">{`${whole(e.spentNow)} of ${whole(budget)}`}</span>
      <Jar fill={budget > 0 ? e.spentNow / budget : 1} over={left < 0} className="jar-mini" />
      <BudgetSlider label={l.label} spent={e.spentNow} budget={budget} scale={sliderScale(e)} onChange={onBudget} />
      <span className={`track-left${left < 0 ? ' is-over' : ''}`}>
        {left >= 0 ? `${whole(left)} left` : `${whole(-left)} over`}
        {fund ? <span className="track-fund">{fund.balance < 0 ? ` · fund ${whole(-fund.balance)} short` : ` · ${whole(fund.balance)} in the fund`}</span> : null}
      </span>
    </li>
  );
}

// A fixed cost is either paid this month or still to come.
function BillRow({ e }) {
  const l = look(e.category);
  const paid = e.spentNow >= e.budget * 0.9;
  return (
    <li className="bill-row">
      <Link className="track-name" href={txLink({ category: e.category })}><Swatch category={e.category} size="sm" /><span>{l.label}</span></Link>
      <span className="track-amounts"><Money cents={paid ? e.spentNow : e.budget} /></span>
      <span className={`bill-state${paid ? ' is-paid' : ''}`}>{paid ? <><Icon name="check" />Paid</> : 'Still to come'}</span>
    </li>
  );
}

function Row({ e, months, fund, value, suggestion, onChange, invalid, group, onGroup }) {
  const { tip } = useApp();
  const l = look(e.category);
  const budget = value.trim() ? parseEuros(value) : null;
  const all = [...e.months, e.spentNow];
  const max = Math.max(1, ...all, budget ?? 0, suggestion.cents ?? 0);
  const h = (c) => `${Math.max(c > 0 ? 6 : 0, (c / max) * 100)}%`;
  const quiet = e.average === 0 && e.spentNow === 0;
  return (
    <li className={`budget-row${quiet ? ' is-quiet' : ''}`}>
      <div className="budget-env">
        <Swatch category={e.category} size="sm" />
        <div>
          <Link className="who" href={txLink({ category: e.category })}>{l.label}</Link>
          <span className="row-tags">
            <button type="button" className={`group-tag is-${group}`} onClick={() => onGroup(group === 'needs' ? 'wants' : 'needs')}
              aria-label={`${l.label} is a ${group === 'needs' ? 'need' : 'want'}. Switch to ${group === 'needs' ? 'want' : 'need'}`}
              title="Click to switch between need and want">{group === 'needs' ? 'Need' : 'Want'}</button>
            <span className={`kind-tag is-${e.kind}`} title={KIND[e.kind][1]}>{KIND[e.kind][0]}</span>
            {fund ? <a className="kind-tag is-fund" href="#funds" title="What isn’t spent stays in the fund">Fund</a> : null}
          </span>
        </div>
      </div>
      <div className="spark" style={{ '--c': l.color }} role="img"
        aria-label={`${l.label}: ${e.months.map((c, i) => `${fmtMonth(months[i], 'short')} ${fmtMoney(c)}`).join(', ')}, this month ${fmtMoney(e.spentNow)}`}>
        {all.map((c, i) => (
          <span key={i} className={`spark-bar${i === all.length - 1 ? ' is-now' : ''}${budget != null && c > budget ? ' is-over' : ''}`} style={{ height: h(c) }}
            {...tipHandlers(tip, (ev) => tip.show(ev, i === all.length - 1 ? 'This month so far' : fmtMonth(months[i]), [{ color: l.color, value: fmtMoney(c), label: l.label }]))} />
        ))}
        {budget ? <i className="spark-line" style={{ bottom: h(budget) }} /> : null}
      </div>
      <div className="budget-typical">
        <span className="m-label">Typical</span>
        <b><Money cents={e.kind === 'irregular' ? e.average : e.median} /></b>
        <span>{e.low === e.high ? 'every month' : `${e.kind === 'irregular' ? 'avg · ' : ''}${whole(e.low)}–${whole(e.high)}`}</span>
      </div>
      <div className="budget-suggest">
        <span className="m-label">Suggested</span>
        {suggestion.cents != null ? (
          <>
            <button className="link-btn" type="button" onClick={() => onChange(toText(suggestion.cents))}
              aria-label={`Use the suggestion for ${l.label}: ${fmtMoney(suggestion.cents)}`}>
              {suggestion.ai ? <Icon name="sparkle" /> : null}{whole(suggestion.cents)}
            </button>
            {suggestion.reason ? <span className="reason">{suggestion.reason}</span> : null}
          </>
        ) : null}
      </div>
      <div className="budget-input">
        <label className={`money-input${invalid ? ' is-invalid' : ''}`}>
          <span aria-hidden="true">€</span>
          <input type="text" inputMode="decimal" placeholder="no limit" aria-label={`Budget for ${l.label} a month`}
            value={value} onChange={(ev) => onChange(ev.target.value)} />
        </label>
        {fund ? (
          <span className={`budget-now${fund.balance < 0 ? ' is-over' : ''}`}>
            {fund.balance < 0 ? `fund ${whole(-fund.balance)} short` : `${whole(fund.balance)} in the fund`}
          </span>
        ) : budget != null ? (
          <span className={`budget-now${e.spentNow > budget ? ' is-over' : ''}`}>
            {e.spentNow > budget ? `${whole(e.spentNow - budget)} over this month` : `${whole(budget - e.spentNow)} left this month`}
          </span>
        ) : null}
      </div>
    </li>
  );
}

// ---------- the plan at a glance: four tiles and at most three tips ----------

const RULES_SHORT = { '50-30-20': '50/30/20', '60-20-20': '60/20/20', '70-20-10': '70/20/10' };
const pctOf = (c, income) => (income > 0 ? Math.round((c / income) * 100) : 0);
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

function Plan({ data, rule, setRule, groups, budgetOf, total, onTrimWants }) {
  const income = data.income;
  const [needShare, wantShare, saveShare] = data.rules[rule];
  const hasBudget = total > 0;
  // "Spend" is the average of the finished months, so a trip or a yearly insurance counts fully.
  const group = (g, share) => {
    const es = data.pots.filter((e) => groups[e.category] === g);
    return {
      share,
      target: Math.round(income * share),
      spend: es.reduce((t, e) => t + e.average, 0),
      budget: hasBudget ? es.reduce((t, e) => t + (budgetOf(e.category) ?? 0), 0) : null,
      top: es.filter((e) => e.average > 0).sort((a, b) => b.average - a.average).slice(0, 3),
    };
  };
  const needs = group('needs', needShare);
  const wants = group('wants', wantShare);
  const saved = Math.max(0, data.savedAverage);
  const savings = { share: saveShare, target: Math.round(income * saveShare), spend: saved, budget: data.plannedSavings };
  const unplanned = income - total - data.plannedSavings;

  // The tips, most important first; never more than three.
  const tips = [];
  if (hasBudget && unplanned < 0) {
    tips.push({ tone: 'over', text: <>Your budget and savings plan add up to <b>{whole(-unplanned)}</b> a month more than your income.</> });
  }
  if (wants.spend > wants.target) {
    const fits = hasBudget && wants.budget <= wants.target;
    tips.push({
      tone: fits ? 'in' : 'over',
      text: <>Wants run <b>{whole(wants.spend - wants.target)}</b> a month over the {Math.round(wantShare * 100)}%, mostly {list(wants.top.map((e) => e.category))}.
        {fits ? <> Your budget brings them to <b>{whole(wants.budget)}</b> ✓</> : null}</>,
      action: fits ? null : { label: 'Trim wants to fit', run: onTrimWants },
    });
  }
  if (hasBudget) {
    const last = data.months.at(-1);
    const over = data.pots.filter((e) => budgetOf(e.category) != null && e.months.at(-1) > budgetOf(e.category))
      .sort((a, b) => (b.months.at(-1) - budgetOf(b.category)) - (a.months.at(-1) - budgetOf(a.category)));
    const name = fmtMonth(last).split(' ')[0];
    tips.push(over.length
      ? { tone: 'neutral', text: <>With this budget, {name} would have gone over in {list(over.slice(0, 3).map((e) => `${e.category} (+${whole(e.months.at(-1) - budgetOf(e.category))})`))}{over.length > 3 ? ` and ${over.length - 3} more` : ''}.</> }
      : { tone: 'in', text: <>With this budget, {name} would have stayed within every pot ✓</> });
  }
  if (needs.spend > needs.target) {
    tips.push({ tone: 'neutral', text: <>Needs take {pctOf(needs.spend, income)}% of your income.</> });
  }
  if (saved < savings.target) {
    tips.push({ tone: 'over', text: <>You save <b>{whole(savings.target - saved)}</b> a month less than {Math.round(saveShare * 100)}%. <Link href="/savings">Raise your plan</Link></> });
  }

  return (
    <section className="plan" aria-labelledby="plan-h">
      <div className="plan-head">
        <h2 id="plan-h">Needs, wants, savings</h2>
        <label className="plan-rule">
          <span>Needs / wants / savings rule</span>
          <select value={rule} onChange={(e) => setRule(e.target.value)} aria-label="Budgeting rule: needs, wants, savings">
            {Object.keys(data.rules).map((r) => <option key={r} value={r}>{RULES_SHORT[r]}</option>)}
          </select>
        </label>
      </div>
      <div className="plan-tiles">
        <Tile name="Needs" g={needs} income={income} kind="needs" />
        <Tile name="Wants" g={wants} income={income} kind="wants" />
        <Tile name="Savings" g={savings} income={income} kind="savings" good />
        <article className={`tile is-fit${unplanned < 0 ? ' is-over' : ''}`}>
          <div className="tile-head"><span className="stamp">Fits your income?</span><span className="tile-target">{whole(income)}</span></div>
          <div className="tile-num">{hasBudget ? whole(Math.abs(unplanned)) : '—'}<small>{hasBudget ? (unplanned < 0 ? 'over' : 'unplanned') : 'no budget yet'}</small></div>
          <div className="tile-bar is-stack" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (total / Math.max(income, 1)) * 100)}%` }} />
            <span className="is-save" style={{ width: `${Math.min(100, (data.plannedSavings / Math.max(income, 1)) * 100)}%` }} />
          </div>
          <p className="tile-status">{`Budget ${whole(total)} + savings ${whole(data.plannedSavings)}`}</p>
        </article>
      </div>
      <SplitChart data={data} groups={groups} income={income} shares={{ needs: needShare, wants: wantShare, savings: saveShare }} />
      {tips.length ? (
        <ul className="plan-tips">
          {tips.slice(0, 3).map((t, i) => (
            <li key={i} className={`is-${t.tone}`}>
              <span className="tip-dot" aria-hidden="true" />
              <span>{t.text}</span>
              {t.action ? <button className="btn btn-sm" type="button" onClick={t.action.run}>{t.action.label}</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
// ---------- month by month: each group's share of income per month, against the plan ----------

const SPLIT = [
  { key: 'needs', label: 'Needs', good: false },
  { key: 'wants', label: 'Wants', good: false },
  { key: 'savings', label: 'Savings', good: true },
];

// Each finished month's needs, wants and savings as a share of income.
function splitMonths(data, groups, income) {
  const pct = (cents) => Math.round((cents / income) * 100);
  return data.months.map((month, i) => {
    const sum = (g) => data.pots.filter((e) => groups[e.category] === g).reduce((t, e) => t + e.months[i], 0);
    const cents = { needs: sum('needs'), wants: sum('wants'), savings: Math.max(0, data.savedMonths[i] ?? 0) };
    return { month, cents, pct: { needs: pct(cents.needs), wants: pct(cents.wants), savings: pct(cents.savings) } };
  });
}

// One chart: each group's share of income per month as a line, its plan as a dashed line in the same colour.
// The buttons show and hide a group; pointing at a point brings its line forward with what it cost and how
// far from the plan that was.
function SplitChart({ data, groups, income, shares }) {
  const { tip } = useApp();
  const [ref, measured] = useWidth(700);
  const [hidden, setHidden] = useState(() => new Set());
  const [focus, setFocus] = useState(null);
  const months = splitMonths(data, groups, income);
  if (!months.length || !income) return null;
  const shown = SPLIT.filter((g) => !hidden.has(g.key));
  const plan = (g) => Math.round(shares[g.key] * 100);

  const width = Math.max(300, measured);
  const height = 260;
  const m = { top: 16, right: 78, bottom: 26, left: 44 };
  const hi = Math.max(10, ...shown.flatMap((g) => [plan(g), ...months.map((x) => x.pct[g.key])]));
  const top = Math.ceil((hi * 1.1) / 10) * 10;
  const ticks = Array.from({ length: Math.floor(top / (top > 60 ? 20 : 10)) + 1 }, (_, i) => i * (top > 60 ? 20 : 10));
  const y = (v) => m.top + (height - m.top - m.bottom) * (1 - v / top);
  const x = (i) => (months.length === 1 ? (m.left + width - m.right) / 2 : m.left + 12 + (i * (width - m.left - m.right - 24)) / (months.length - 1));

  const toggle = (key) => {
    setFocus(null);
    setHidden((h) => { const next = new Set(h); if (next.has(key)) next.delete(key); else if (shown.length > 1) next.add(key); return next; });
  };
  // What the month cost against the plan: over or left for needs and wants, short or more for savings.
  const tipRows = (g, mo) => {
    const cents = mo.cents[g.key];
    const diff = cents - Math.round(income * shares[g.key]);
    const verdict = g.good
      ? (diff < 0 ? `${fmtMoney(-diff)} short of the plan` : `${fmtMoney(diff)} more than the plan`)
      : (diff > 0 ? `${fmtMoney(diff)} over the plan` : `${fmtMoney(-diff)} left in the plan`);
    return [
      { color: `var(--split-${g.key})`, value: fmtMoney(cents), label: `${mo.pct[g.key]}% of income` },
      { value: verdict, label: `plan ${plan(g)}%` },
    ];
  };

  return (
    <div className="split-view">
      <div className="split-head">
        <h3>Month by month</h3>
        <div className="split-toggles" role="group" aria-label="Show or hide">
          {SPLIT.map((g) => (
            <button key={g.key} type="button" className={`split-toggle is-${g.key}`} aria-pressed={String(!hidden.has(g.key))} onClick={() => toggle(g.key)}>
              <i aria-hidden="true" />{g.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart" ref={ref}>
        <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" className={focus ? 'has-focus' : undefined}
          aria-label={`Share of income per month: ${shown.map((g) => `${g.label} ${months.map((mo) => `${fmtMonth(mo.month, 'short')} ${mo.pct[g.key]}%`).join(', ')}, plan ${plan(g)}%`).join('; ')}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'base' : 'grid'} x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} />
              <text x={m.left - 8} y={y(v) + 4} textAnchor="end">{`${v}%`}</text>
            </g>
          ))}
          {months.map((mo, i) => <text key={mo.month} x={x(i)} y={height - 6} textAnchor="middle">{fmtMonth(mo.month, 'short')}</text>)}
          {[...shown].sort((a, b) => (a.key === focus) - (b.key === focus)).map((g) => (
            <g key={g.key} className={`split-series is-${g.key}${focus === g.key ? ' is-focus' : ''}`}>
              <line className="split-plan" x1={m.left} x2={width - m.right} y1={y(plan(g))} y2={y(plan(g))} />
              <text className="split-plan-label" x={width - m.right + 6} y={y(plan(g)) + 4}>{`${g.label} plan`}</text>
              <polyline className="split-path" points={months.map((mo, i) => `${x(i)},${y(mo.pct[g.key])}`).join(' ')} />
              {months.map((mo, i) => (
                <g key={mo.month}>
                  <circle className="split-point" cx={x(i)} cy={y(mo.pct[g.key])} r={4.5} />
                  {focus === g.key ? <text className="split-value" x={x(i)} y={y(mo.pct[g.key]) - 10} textAnchor="middle">{`${mo.pct[g.key]}%`}</text> : null}
                  <circle className="split-hit" cx={x(i)} cy={y(mo.pct[g.key])} r={12} tabIndex={0}
                    aria-label={`${g.label}, ${fmtMonth(mo.month)}: ${tipRows(g, mo).map((r) => r.value).join(', ')}`}
                    onPointerEnter={() => setFocus(g.key)} onPointerLeave={() => { setFocus(null); tip.hide(); }}
                    onFocus={(e) => { setFocus(g.key); tip.show(e, `${g.label} · ${fmtMonth(mo.month)}`, tipRows(g, mo)); }}
                    onBlur={() => { setFocus(null); tip.hide(); }}
                    onPointerMove={(e) => tip.show(e, `${g.label} · ${fmtMonth(mo.month)}`, tipRows(g, mo))} />
                </g>
              ))}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// One group as a share of income: the fill is what you spend, the line is the rule's target.
function Tile({ name, g, income, kind, good = false }) {
  const pct = pctOf(g.spend, income);
  const target = Math.round(g.share * 100);
  const diff = g.spend - g.target;
  const bad = good ? diff < 0 : diff > 0;
  const status = good
    ? (diff >= 0 ? `${whole(diff)} above target ✓` : `${whole(-diff)} short`)
    : (diff > 0 ? `${whole(diff)} over` : `${whole(-diff)} room left`);
  return (
    <article className={`tile is-${kind}${bad ? ' is-over' : ''}`}>
      <div className="tile-head"><span className="stamp">{name}</span><span className="tile-target">{`target ${target}%`}</span></div>
      <div className="tile-num">{`${pct}%`}<small>{`${whole(g.spend)} a month`}</small></div>
      <div className="tile-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, pct)}%` }} />
        <i style={{ left: `${target}%` }} />
      </div>
      <p className="tile-status">
        <b>{status}</b>
        {g.budget != null ? <span>{` · ${good ? 'plan' : 'budget'} ${whole(g.budget)}${!good && g.budget > g.target ? ' (over)' : ''}`}</span> : null}
      </p>
    </article>
  );
}
