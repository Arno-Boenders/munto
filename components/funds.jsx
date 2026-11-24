'use client';
import { useState } from 'react';
import Link from 'next/link';
import { look } from '@/lib/look.js';
import { fmtDate, fmtMoney, fmtMonth, parseEuros, plural, txLink } from '@/lib/format.js';
import { api, tipHandlers, useApp } from './app.jsx';
import { Icon, Money, Swatch } from './ui.jsx';

const toText = (c) => (c == null || c === 0 ? '' : (c / 100).toLocaleString('nl-BE', { minimumFractionDigits: c % 100 ? 2 : 0 }));
const whole = (cents) => fmtMoney(Math.round(cents / 100) * 100).replace(/,00$/, '');

// Sinking funds on the Budget page: pots that keep what's left over, so the big months (a trip, the
// yearly gym) are paid from what earlier months didn't spend instead of landing all at once.
export function Funds({ data, budgetOf }) {
  const { toast, refresh } = useApp();
  const [open, setOpen] = useState(null); // { category, budget, start, editing }
  const [busy, setBusy] = useState(false);
  const isFund = new Set(data.funds.map((f) => f.category));
  const yearlyIn = (c) => data.yearlyCosts.filter((y) => y.category === c);
  // Ideas: pots with big months now and then, or a yearly bill in them.
  // The ones with a yearly bill first, then the ones whose biggest month is furthest above average.
  const ideas = data.pots.filter((e) => !isFund.has(e.category) && e.average > 0 && (e.kind === 'irregular' || yearlyIn(e.category).length))
    .sort((a, b) => (yearlyIn(b.category).length > 0) - (yearlyIn(a.category).length > 0) || b.high / b.average - a.high / a.average);
  const total = data.funds.reduce((t, f) => t + f.balance, 0);

  async function send(body, done) {
    setBusy(true);
    try { await api('/api/funds', { method: 'POST', body }); toast(done); setOpen(null); refresh(); } catch (err) { toast(err.message); }
    setBusy(false);
  }
  const start = (e) => setOpen({ category: e.category, budget: toText(budgetOf(e.category) ?? e.budget ?? e.plain), start: '', editing: false });

  return (
    <section className="panel funds" id="funds" aria-labelledby="funds-h">
      <div className="panel-head">
        <div>
          <h2 id="funds-h">Funds</h2>
          <span className="sub">Pots that keep what’s left over</span>
        </div>
        {data.funds.length ? <span className="panel-total"><Money cents={total} /></span> : null}
      </div>

      {data.funds.length ? (
        <ul className="fund-list">
          {data.funds.map((f) => (
            <Fund key={f.category} f={f} open={open?.category === f.category ? open : null}
              onEdit={() => setOpen({ category: f.category, start: toText(f.startCents), editing: true })}
              onStop={() => send({ category: f.category, stop: true }, `${f.category} is a normal pot again · its budget stays`)} />
          ))}
        </ul>
      ) : <p className="empty-line">No funds yet.</p>}

      {open ? (
        <FundForm open={open} setOpen={setOpen} busy={busy}
          onSave={() => {
            const startCents = open.start.trim() ? parseEuros(open.start) : 0;
            if (startCents == null) return toast('Type what you already set aside, or leave it empty');
            if (open.editing) return send({ category: open.category, startCents }, `${open.category}: start amount saved`);
            const budgetCents = parseEuros(open.budget);
            if (!(budgetCents > 0)) return toast(`Type how much goes into ${open.category} a month`);
            send({ category: open.category, budgetCents, startCents }, `${open.category} is a fund now · ${whole(budgetCents)} goes in every payday`);
          }} />
      ) : null}

      {ideas.length ? (
        <div className="fund-ideas">
          <span className="stamp">Could be a fund</span>
          <ul>
            {ideas.slice(0, 4).map((e) => {
              const bills = yearlyIn(e.category);
              return (
                <li key={e.category}>
                  <Swatch category={e.category} size="sm" />
                  <span>
                    <b>{look(e.category).label}</b>
                    {bills.length
                      ? ` · ${bills.map((y) => `${y.name} ${whole(y.cents)} ${y.every === 'year' ? 'a year' : 'a quarter'}`).join(', ')}`
                      : ` · ${whole(e.low)} to ${whole(e.high)} a month, ${whole(e.average)} on average`}
                  </span>
                  <button className="btn btn-sm" type="button" onClick={() => start(e)} disabled={open?.category === e.category}>Make it a fund</button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Fund({ f, open, onEdit, onStop }) {
  const { tip } = useApp();
  const l = look(f.category);
  const short = f.balance < 0;
  const max = Math.max(1, ...f.months.map((m) => Math.abs(m.balance)));
  const used = f.months.reduce((t, m) => t + m.fromFund, 0);
  return (
    <li className={`fund${open ? ' is-open' : ''}`} style={{ '--c': l.color }}>
      <Swatch category={f.category} size="sm" />
      <div className="fund-main">
        <Link className="who" href={txLink({ category: f.category })}>{l.label}</Link>
        <span className="fund-meta">
          {`${whole(f.budget)} a month${f.months.length > 1 ? ` since ${fmtMonth(f.since, 'short')}` : ''}`}
          {f.startCents ? ` · started with ${whole(f.startCents)}` : ''}
          {used > 0 ? ` · ${whole(used)} paid from it` : ''}
        </span>
        {f.upcoming.length ? (
          <ul className="fund-due">
            {f.upcoming.map((u) => (
              <li key={u.name + u.date} className={u.ready ? 'is-ready' : 'is-short'}>
                <span><b>{u.name}</b>{` ${whole(u.cents)} on ${fmtDate(u.date)} · `}
                  {u.ready
                    ? <em>{`on track, about ${whole(u.expected)} to spare`}</em>
                    : <><em>{`about ${whole(-u.expected)} short by then`}</em>{`: put in ${whole(Math.ceil(-u.expected / Math.max(1, u.paydays) / 100) * 100)} more a month`}</>}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {f.months.length > 1 ? <div className="fund-history" role="img"
        aria-label={`${l.label} fund per month: ${f.months.map((m) => `${fmtMonth(m.month, 'short')} ${fmtMoney(m.balance)}`).join(', ')}`}>
        {f.months.slice(-12).map((m) => (
          <span key={m.month} className={`fund-bar${m.balance < 0 ? ' is-short' : ''}`} style={{ height: `${Math.max(m.balance ? 8 : 0, (Math.abs(m.balance) / max) * 100)}%` }}
            {...tipHandlers(tip, (ev) => tip.show(ev, fmtMonth(m.month), [
              { color: l.color, label: 'Carried in', value: fmtMoney(m.carried) },
              { color: l.color, label: 'Put in', value: `+${fmtMoney(m.putIn)}` },
              { color: l.color, label: 'Spent', value: `−${fmtMoney(Math.max(0, m.spent))}` },
              { color: m.balance < 0 ? 'var(--over-fill)' : l.color, label: 'In the fund', value: fmtMoney(m.balance) },
            ]))} />
        ))}
      </div> : <span className="fund-history is-new">{f.startDate ? `started ${fmtDate(f.startDate).replace(/ \d{4}$/, '')}` : 'started this month'}</span>}
      <div className="fund-balance">
        <b className={short ? 'is-over' : ''}><Money cents={Math.abs(f.balance)} /></b>
        <span>{short ? 'short' : 'in the fund'}</span>
        <span className="fund-actions">
          <button className="link-btn" type="button" onClick={onEdit}>Edit</button>
          <button className="link-btn" type="button" onClick={onStop}>Stop</button>
        </span>
      </div>
    </li>
  );
}

function FundForm({ open, setOpen, onSave, busy }) {
  const set = (k) => (ev) => setOpen({ ...open, [k]: ev.target.value });
  return (
    <form className="fund-form" onSubmit={(ev) => { ev.preventDefault(); onSave(); }}>
      <b>{open.editing ? `Edit the ${open.category} fund` : `Make ${open.category} a fund`}</b>
      {!open.editing ? (
        <label>
          <span>Goes in every payday</span>
          <span className="money-input"><span aria-hidden="true">€</span>
            <input type="text" inputMode="decimal" value={open.budget} onChange={set('budget')} aria-label={`What goes into ${open.category} a month`} autoFocus />
            <span className="per">a month</span></span>
        </label>
      ) : null}
      <label>
        <span>Already set aside for it</span>
        <span className="money-input"><span aria-hidden="true">€</span>
          <input type="text" inputMode="decimal" placeholder="0" value={open.start} onChange={set('start')} aria-label={`Already set aside for ${open.category}`} autoFocus={open.editing} /></span>
      </label>
      <p className="fund-form-note">
        {open.editing
          ? 'What the fund started with. To change what goes in each month, change its budget in the table above.'
          : 'This becomes the pot’s budget. From today, what you don’t spend stays in the fund for the months you spend more.'}
      </p>
      <span className="fund-form-actions">
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(null)}>Cancel</button>
        <button className="btn btn-ink btn-sm" type="submit" disabled={busy}><Icon name="check" />{open.editing ? 'Save' : 'Start the fund'}</button>
      </span>
    </form>
  );
}
