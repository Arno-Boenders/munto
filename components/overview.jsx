'use client';
import { useState } from 'react';
import Link from 'next/link';
import { look } from '@/lib/look.js';
import { fmtDate, fmtMoney, fmtMonth, fmtPeriod, plural, signed, tidy, txLink } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { Icon, Jar, Money, MonthStepper, Swatch, SyncButton, useGrown } from './ui.jsx';
import { LookBackPrompt } from './lookback.jsx';

// The month at a glance: what's left, what needs you, and the pots. Charts and lists live under Trends.
export function Overview({ data, unsorted, lookback }) {
  const { config, router } = useApp();
  const grown = useGrown();
  if (!data.month) return <EmptyState />;
  const { totals, previousTotals } = data;
  const pots = data.pots.filter((e) => e.net > 0 || e.back > 0 || e.budget > 0);
  const budgeted = pots.filter((e) => e.budget != null && e.category);

  return (
    <div>
      <div className="page-head">
        <div className="page-head-left">
          <h1>Overview</h1>
          <MonthStepper months={data.months} month={data.month} onPick={(m) => router.push(`/?month=${m}`)} />
          <span className="sub">{fmtPeriod(data.period)}</span>
        </div>
        <div className="sync-row">
          <span className="sub">{data.lastSynced ? `Synced ${fmtDate(data.lastSynced.slice(0, 10))}` : 'Not synced yet'}</span>
          <SyncButton small />
        </div>
      </div>

      <div className="overview">
        <section className="ledger" aria-label="This month">
          <Equation data={data} totals={totals} previousTotals={previousTotals} transferCategory={config.transferCategory} trends={config.features.trends} />
        </section>

        {unsorted > 0 || data.accessEnding.length || (data.isCurrent && lookback && !lookback.done) ? (
          <div className="todo">
            {data.accessEnding.map((a) => ( // from a week before a bank's access ends: renew it or syncing stops
              <Link key={a.bank} className="todo-unsorted" href="/accounts">
                <b>{a.title}</b>
                <span className="btn btn-need btn-sm">Renew</span>
              </Link>
            ))}
            {unsorted > 0 ? (
              <Link className="todo-unsorted" href="/review">
                <b>{`${plural(unsorted, 'transaction')} not in a pot yet`}</b>
                <span className="btn btn-need btn-sm">Sort them</span>
              </Link>
            ) : null}
            {data.isCurrent ? <LookBackPrompt lb={lookback} /> : null}
          </div>
        ) : null}

        <section className="section sec-env" aria-labelledby="env-h">
          <div className="section-head">
            <h2 id="env-h">Pots</h2>
            <p className="sub">{budgeted.length
              ? <>{`${fmtMoney(budgeted.reduce((t, e) => t + Math.max(0, e.net), 0))} of `}<Link href="/budget">{`${fmtMoney(budgeted.reduce((t, e) => t + e.budget, 0))} budget`}</Link>{' used'}</>
              : <Link href="/budget">Set a budget</Link>}</p>
          </div>
          {pots.length
            ? <PotGrid items={pots} render={(e, focus) => <PotCard key={e.category ?? ''} e={e} month={data.month} grown={grown} focus={focus} />} keyOf={(e) => e.category ?? ''} />
            : <p className="sub">No spending this month yet.</p>}
        </section>

        {config.features.savings && data.savings.length ? (
          <section className="section sec-save" aria-labelledby="save-h">
            <div className="section-head">
              <h2 id="save-h">Savings</h2>
              <p className="sub"><Link href="/savings">Savings plan</Link></p>
            </div>
            <PotGrid items={data.savings} render={(p, focus) => <SavingsCard key={p.key} p={p} month={data.month} grown={grown} focus={focus} />} keyOf={(p) => p.key} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Equation({ data, totals, previousTotals, transferCategory, trends }) {
  const paidBack = `after ${fmtMoney(totals.paidBack)} paid back`;
  const spentNote = totals.paidBack <= 0 ? null : trends ? <Link href={`/trends?month=${data.month}#paid-back`}>{paidBack}</Link> : paidBack;
  // Fixed savings plans not done yet this month: Left also says what's left once they've gone out.
  const stillToSave = data.isCurrent ? data.savings.reduce((t, p) => t + (p.planned ? Math.max(0, p.planned - Math.max(0, p.net)) : 0), 0) : 0;
  const leftNote = previousTotals ? `${fmtMonth(previousTotals.month, 'long').split(' ')[0]}: ${signed(previousTotals.left)}` : '';
  const savedLink = txLink({ month: data.month, category: transferCategory });
  const savedNote = totals.saved < 0 ? <Link href={savedLink}>taken out of savings</Link>
    : totals.saved > 0 ? <Link href={savedLink}>to savings</Link> : null;
  // Before the salary lands, expected income (if set) fills in, so Left says what the month will look like.
  const expecting = data.isCurrent && totals.income === 0 && data.expectedIncome > 0;
  const incomeCents = expecting ? data.expectedIncome : totals.income;
  const left = expecting ? incomeCents - totals.spent - totals.saved : totals.left;
  // Funds: what this month keeps in them (or takes out) is part of Left, but not free to spend.
  const kept = totals.kept ?? 0;
  const fundsNote = totals.kept == null ? null
    : kept >= 0 ? `${fmtMoney(kept)} kept in funds` : `${fmtMoney(-kept)} paid from funds`;
  const incomeNote = expecting ? <Link href="/income">expected, not in yet</Link>
    : data.incomeFrom.length
      ? tidy(data.incomeFrom[0].who) + (data.incomeFrom.length > 1 ? ` +${data.incomeFrom.length - 1}` : '')
      : null;
  // The ledger line: Income − Spent − Saved = Left, which reconciles exactly.
  return (
    <div className="equation" role="group" aria-label="Income minus spent minus saved equals left">
      <div className="eq-term"><span className="stamp">Income</span><span className={`eq-value${expecting ? ' is-expected' : ''}`}><Money cents={incomeCents} /></span><span className="eq-note">{incomeNote}</span></div>
      <span className="eq-op" aria-hidden="true">−</span>
      <div className="eq-term"><span className="stamp">Spent</span><span className="eq-value"><Money cents={totals.spent} /></span><span className="eq-note">{spentNote}</span></div>
      <span className="eq-op" aria-hidden="true">−</span>
      <div className="eq-term"><span className="stamp">Saved</span><span className="eq-value"><Money cents={totals.saved} /></span><span className="eq-note">{savedNote}</span></div>
      <span className="eq-op eq-op-result" aria-hidden="true">=</span>
      <div className="eq-term eq-left">
        <span className="stamp">Left</span>
        <span className={`eq-value ${left < 0 ? 'is-over' : 'is-in'}`}><Money cents={left} sign /></span>
        <span className="eq-note">
          {fundsNote
            ? <Link href="/budget#funds" className={left - stillToSave - kept < 0 ? 'is-over' : undefined} title={`${fundsNote}${stillToSave > 0 ? `, ${fmtMoney(stillToSave)} still to save` : ''}`}>
              {`${signed(left - stillToSave - kept)} free after funds${stillToSave > 0 ? ' & saving' : ''}`}</Link>
            : stillToSave > 0
            ? <Link href="/savings">{`${signed(left - stillToSave)} after ${fmtMoney(stillToSave)} still to save`}</Link>
            : expecting ? 'once your salary lands' : leftNote}
        </span>
      </div>
    </div>
  );
}

// The first screen: set up your bank, or look around with sample data first (removed again under Settings,
// and by itself once you link your own bank).
export function EmptyState() {
  const { toast, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  async function trySample() {
    setBusy(true);
    try {
      await api('/api/setup/sample', { method: 'POST', body: {} });
      toast('Sample data added · remove it any time under Settings');
      refresh();
    } catch (err) { toast(err.message); setBusy(false); }
  }
  return (
    <div className="empty"><Jar fill={0} className="jar-empty" />
      <strong>No transactions yet</strong>
      Set up Munto and connect your bank, or try it first with sample data.
      <div className="empty-actions">
        <Link className="btn btn-ink" href="/settings"><Icon name="check" />Set up Munto</Link>
        <button className="btn" type="button" disabled={busy} onClick={trySample}>{busy ? 'One moment…' : 'Try with sample data'}</button>
      </div>
    </div>
  );
}

// A grid of pots where hovering one fades the others. Only a mouse hovers: a tap would fade them just
// before the page changes.
function PotGrid({ items, render, keyOf }) {
  const [focused, setFocused] = useState(null);
  return (
    <div className={`pots${focused != null ? ' has-focus' : ''}`}>
      {items.map((item) => {
        const key = keyOf(item);
        return render(item, {
          active: focused === key,
          handlers: {
            onPointerEnter: (e) => { if (e.pointerType === 'mouse') setFocused(key); }, onPointerLeave: () => setFocused(null),
            onFocus: () => setFocused(key), onBlur: () => setFocused(null),
          },
        });
      })}
    </div>
  );
}

function PotCard({ e, month, grown, focus }) {
  const l = look(e.category);
  const unsorted = !e.category;
  // Against the budget if there is one, otherwise the usual.
  const hasBudget = e.budget != null && !unsorted;
  const target = hasBudget ? e.budget : e.usual;
  // A fund can also spend what earlier months carried in, so the jar holds budget + carried.
  const room = e.fund ? target + Math.max(0, e.fund.carried) : target;
  const diff = e.usual > 0 ? Math.round(((e.net - e.usual) / e.usual) * 100) : null;
  const aboveUsual = diff != null && diff > 15;
  const overBudget = e.fund ? e.fund.balance < 0 : hasBudget && e.net > e.budget;
  const label = `${l.label}${overBudget ? ', over budget' : ''}: ${fmtMoney(e.net)} net${e.back ? `, ${fmtMoney(e.back)} paid back` : ''}${diff != null ? `, ${Math.abs(diff)}% ${diff >= 0 ? 'above' : 'below'} usual` : ''}`;
  const usualText = diff == null ? 'no usual yet'
    : diff === 0 ? 'right on usual'
    : diff >= 200 ? `${(e.net / e.usual).toFixed(e.net / e.usual >= 10 ? 0 : 1).replace('.', ',')}× usual`
    : `${Math.abs(diff)}% ${diff > 0 ? 'above' : 'below'} usual`;

  if (unsorted) {
    return (
      <Link className={`pot is-unsorted${focus.active ? ' is-focus' : ''}`} href="/review" {...focus.handlers} aria-label={label}>
        <div className="pot-name"><span>{l.label}</span><span className="pot-count">{`${e.count}×`}</span></div>
        <div className="pot-amt"><Money cents={e.net} /><em>to sort</em></div>
        <div className="pot-meta">Sort them →</div>
      </Link>
    );
  }
  // The big figure: what's left of the budget (or the fund), or without a budget what went out.
  const left = e.fund ? (e.fund.balance < 0 ? e.fund.balance : e.budget - Math.max(0, e.fund.spent)) : hasBudget ? e.budget - e.net : null;
  return (
    <Link className={`pot${overBudget ? ' is-over' : ''}${focus.active ? ' is-focus' : ''}`}
      href={txLink({ month, category: e.category })} style={{ '--c': l.color }} {...focus.handlers} aria-label={label}>
      <div className="pot-name"><Swatch category={e.category} size="sm" /><span>{l.label}</span></div>
      <Jar fill={room > 0 ? e.net / room : e.net > 0 ? 1 : 0} usual={hasBudget && e.usual > 0 ? e.usual / room : null}
        usualText={`usual ${fmtMoney(e.usual).replace(/,00$/, '')}`} over={overBudget} grown={grown} />
      {left != null ? (
        <div className={`pot-amt${left < 0 ? ' is-over' : ''}`}>
          <Money cents={left} sign={left < 0} />
          {left < 0 ? <span className="pot-stamp">Over</span> : <em>{e.fund && e.fund.fromFund > 0 ? 'left, fund helping' : 'left'}</em>}
        </div>
      ) : (
        <div className={`pot-amt${e.net < 0 ? ' is-in' : ''}`}>
          {e.net < 0 ? <Money cents={-e.net} sign /> : <Money cents={e.net} />}<em>{e.net < 0 ? 'more came back' : 'spent'}</em>
        </div>
      )}
      <div className="pot-meta">
        {e.fund ? `${fmtMoney(Math.max(0, e.net))} of ${fmtMoney(e.budget)} · ${e.fund.balance < 0 ? 'fund empty' : `fund ${fmtMoney(e.fund.balance)}`}`
          : hasBudget ? `${fmtMoney(Math.max(0, e.net))} of ${fmtMoney(e.budget)}`
          : <span className={aboveUsual ? 'is-over' : undefined}>{usualText}</span>}
      </div>
      {e.back > 0 ? <div className="pot-back">{`+${fmtMoney(e.back)} paid back`}</div> : null}
    </Link>
  );
}

// A savings pot: what went into one of your own savings or investment accounts this month. Putting in more
// than usual is good, so it never turns red; with a fixed plan, the jar's shoulder is the plan.
function SavingsCard({ p, month, grown, focus }) {
  const name = p.name ?? (p.iban ? `${tidy(p.who)} · …${p.iban.slice(-4)}` : tidy(p.who));
  const iconName = /saxo|bux|invest|beleg|degiro|bolero/i.test(name) ? 'growth' : /revolut|wallet|cash/i.test(name) ? 'wallet' : 'bank';
  const target = p.planned ?? p.usual;
  return (
    <Link className={`pot is-saving${focus.active ? ' is-focus' : ''}`} {...focus.handlers}
      href={txLink({ month, ...(p.iban ? { iban: p.iban } : { q: p.who.toLowerCase() }) })}
      aria-label={`${name}: ${fmtMoney(p.put)} put in${p.took ? `, ${fmtMoney(p.took)} taken out` : ''}, net ${signed(p.net)}`}>
      <div className="pot-name"><span className="swatch sm"><Icon name={iconName} /></span><span>{name}</span></div>
      <Jar fill={target > 0 ? p.net / target : p.net > 0 ? 1 : 0} usual={null} over={false} grown={grown} />
      <div className={`pot-amt${p.net > 0 ? ' is-in' : ''}`}><Money cents={p.net} sign /><em>{p.net < 0 ? 'taken out' : 'put aside'}</em></div>
      <div className="pot-meta">
        {p.planned
          ? (p.net >= p.planned ? <span className="is-in">Plan done</span> : `${fmtMoney(p.planned - Math.max(0, p.net))} to go`)
          : p.net >= 0 && p.usual > 0 && p.net < p.usual ? `${fmtMoney(p.usual - p.net)} under usual` : null}
      </div>
      {p.took > 0 && p.put > 0 ? <div className="pot-back is-out">{p.net >= 0 ? `${fmtMoney(p.took)} taken out` : `${fmtMoney(p.put)} put in`}</div> : null}
    </Link>
  );
}

