'use client';
import { useState } from 'react';
import Link from 'next/link';
import { look } from '@/lib/look.js';
import { fmtMoney, fmtMonth, fmtShort, plural, txLink } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { Icon, Money, Swatch } from './ui.jsx';

const whole = (cents) => fmtMoney(Math.round(cents / 100) * 100).replace(/,00$/, '');
const monthName = (m) => fmtMonth(m, 'long').split(' ')[0];
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// The look back at last month on the Budget page: per pot that went over, raise the budget or keep it
// as a target; per pot that stayed well under, lower it. A gentle monthly review, then put it away.
export function LookBack({ lb }) {
  const { toast, refresh } = useApp();
  const [busy, setBusy] = useState(null);
  if (!lb || lb.done || !lb.pots.length) return null; // nothing had a budget that month
  const name = monthName(lb.month);
  const over = lb.pots.filter((e) => e.status === 'over');
  const slack = lb.pots.filter((e) => e.status === 'slack');
  const within = lb.pots.filter((e) => e.status === 'within');
  const funds = lb.pots.filter((e) => e.status === 'fund');
  const budgeted = lb.pots.reduce((t, e) => t + e.budget, 0);
  const spent = lb.pots.reduce((t, e) => t + e.spent, 0);
  const ok = within.length + slack.length + funds.filter((e) => e.fund.balance >= 0).length;

  async function send(body, done) {
    setBusy(body.category ?? 'done');
    try { await api('/api/lookback', { method: 'POST', body: { month: lb.month, ...body } }); toast(done); refresh(); } catch (err) { toast(err.message); }
    setBusy(null);
  }

  return (
    <section className="panel lookback" id="lookback" aria-labelledby="lookback-h">
      <div className="panel-head">
        <div>
          <h2 id="lookback-h">{`Looking back at ${name}`}</h2>
          <span className="sub">{`${fmtShort(lb.start)} – ${fmtShort(lb.end)}`}</span>
        </div>
      </div>

      <p className="lookback-sum">
        <b>{`${ok} of ${plural(lb.pots.length, 'pot')}`}</b>{' stayed within budget. '}
        {`Budgeted pots took ${whole(spent)} of ${whole(budgeted)}`}
        {lb.totals.saved > 0 ? `, ${whole(lb.totals.saved)} went to savings` : ''}
        {`, and the month ended ${lb.totals.left < 0 ? `${whole(-lb.totals.left)} short` : `with ${whole(lb.totals.left)} left`}.`}
      </p>

      {over.length || slack.length ? (
        <ul className="lookback-list">
          {[...over, ...slack].map((e) => <Item key={e.category} e={e} name={name} busy={busy === e.category} send={send} />)}
        </ul>
      ) : <p className="lookback-good"><Icon name="check" />{`Every pot stayed within its budget in ${name}.`}</p>}

      {funds.length ? (
        <p className="lookback-line">
          <span className="stamp">Funds</span>
          {list(funds.map((e) => (e.fund.kept >= 0
            ? `${e.category} kept ${whole(e.fund.kept)}`
            : `${e.category} paid ${whole(-e.fund.kept)} from the fund`)))}
          {`. ${funds.length === 1 ? 'It holds' : 'Together they hold'} ${whole(funds.reduce((t, e) => t + e.fund.balance, 0))}.`}
        </p>
      ) : null}
      {within.length ? (
        <p className="lookback-line"><span className="stamp">Within</span>{list(within.map((e) => look(e.category).label))}</p>
      ) : null}

      <div className="panel-foot">
        <button className={`btn btn-sm${lb.open ? '' : ' btn-ink'}`} type="button" disabled={busy === 'done'}
          onClick={() => send({ action: 'done' }, `${name} is put away · next look back after the next payday`)}>
          <Icon name="check" />{lb.open ? `Done with ${name}, leave the rest` : `Done with ${name}`}
        </button>
      </div>
    </section>
  );
}

function Item({ e, name, busy, send }) {
  const l = look(e.category);
  const isOver = e.status === 'over';
  const decided = e.decision === 'raised' || e.decision === 'lowered' ? `Budget is ${whole(e.now)} from now on ✓`
    : e.decision === 'kept' ? `Kept ${whole(e.now)} as the target ✓`
    : e.decision === 'changed' ? (e.now ? `Already changed to ${whole(e.now)} since` : 'Budget removed since')
    : e.suggestion == null && e.now !== e.budget ? `Budget is ${whole(e.now)} now` : null;
  return (
    <li className={`lookback-item lb-${e.status}`}>
      <Swatch category={e.category} size="sm" />
      <div className="lookback-main">
        <Link className="who" href={txLink({ month: e.months.at(-1).month, category: e.category })}>{l.label}</Link>
        <span className="lookback-what">
          <b className={isOver ? 'is-over' : ''}>{whole(e.spent)}</b>{` of ${whole(e.budget)}`}
          {isOver ? ` · ${whole(e.spent - e.budget)} over` : ` · never more than ${whole(Math.max(...e.months.map((m) => m.spent)))} in ${plural(e.months.length, 'month')}`}
          {isOver && e.months.length > 1 ? ` · over in ${e.overCount} of the last ${e.months.length}` : ''}
          {isOver && e.suggestion == null && !e.decision ? ' · usually within, so likely a one-off' : ''}
        </span>
      </div>
      <span className="lookback-dots" role="img"
        aria-label={e.months.map((m) => `${fmtMonth(m.month, 'short')}: ${m.budget ? (m.spent > m.budget ? 'over' : 'within') : 'no budget'}`).join(', ')}>
        {e.months.map((m) => (
          <i key={m.month} className={m.budget ? (m.spent > m.budget ? 'is-over' : 'is-within') : 'is-none'}
            title={`${fmtMonth(m.month)}: ${fmtMoney(m.spent)}${m.budget ? ` of ${fmtMoney(m.budget)}` : ''}`} />
        ))}
      </span>
      <span className="lookback-actions">
        {decided ? <span className="lookback-decided">{decided}</span> : (
          <>
            {e.suggestion != null ? (
              <button className="btn btn-sm" type="button" disabled={busy}
                title={isOver ? 'Enough in 2 of every 3 of the last months' : 'The most it took in these months'}
                onClick={() => send({ category: e.category, action: isOver ? 'raise' : 'lower', cents: e.suggestion }, `${l.label}: ${whole(e.suggestion)} a month from now on`)}>
                {`${isOver ? 'Raise' : 'Lower'} to ${whole(e.suggestion)}`}
              </button>
            ) : null}
            <button className={`btn btn-sm${e.suggestion != null ? ' btn-ghost' : ''}`} type="button" disabled={busy}
              onClick={() => send({ category: e.category, action: 'keep' }, isOver ? `${l.label}: ${whole(e.now)} stays the target` : `${l.label}: keeping ${whole(e.now)}`)}>
              {`Keep ${whole(e.now)}`}
            </button>
          </>
        )}
      </span>
    </li>
  );
}

// On the Overview: a nudge once a month is over, until it's looked back at.
export function LookBackPrompt({ lb }) {
  if (!lb || lb.done || !lb.pots.length) return null; // nothing had a budget that month
  const name = monthName(lb.month);
  const over = lb.pots.filter((e) => e.status === 'over');
  const lower = lb.pots.filter((e) => e.status === 'slack' && e.suggestion != null && !e.decision);
  const text = over.length
    ? `${list([...over.slice(0, 2).map((e) => look(e.category).label), ...(over.length > 2 ? [`${over.length - 2} more`] : [])])} went over.`
    : 'Every pot stayed within its budget.';
  return (
    <section className="panel lookback-prompt" aria-labelledby="lbp-h">
      <div className="panel-head"><h2 id="lbp-h">{`${name} is over`}</h2>
        <span className={`panel-total ${lb.totals.left < 0 ? 'is-over' : 'is-in'}`}><Money cents={lb.totals.left} sign /></span></div>
      <p className="lookback-prompt-text">
        {text}
        {lower.length ? ` ${list(lower.map((e) => look(e.category).label))} could have a lower budget.` : ''}
      </p>
      <div className="panel-foot"><Link className="btn btn-sm btn-ink" href="/budget#lookback">{`Look back at ${name}`}</Link></div>
    </section>
  );
}
