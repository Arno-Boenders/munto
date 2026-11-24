'use client';
import Link from 'next/link';
import { look } from '@/lib/look.js';
import { fmtDate, fmtMoney, fmtPeriod, plural, tidy, txLink } from '@/lib/format.js';
import { useApp } from './app.jsx';
import { Money, MonthStepper, Swatch } from './ui.jsx';
import { PaceChart, Trends } from './charts.jsx';
import { EmptyState } from './overview.jsx';

// The month in detail: spending pace, the trend charts, where the money came from and the biggest spends.
export function TrendsPage({ data }) {
  const { router } = useApp();
  if (!data.month) return <EmptyState />;
  return (
    <div>
      <div className="page-head">
        <div className="page-head-left">
          <h1>Trends</h1>
          <MonthStepper months={data.months} month={data.month} onPick={(m) => router.push(`/trends?month=${m}`)} />
          <span className="sub">{fmtPeriod(data.period)}</span>
        </div>
      </div>

      <div className="trends">
        <div className="trends-main">
          <section className="trends-pace" aria-label="Spending pace">
            <PaceChart pace={data.pace} month={data.month} isCurrent={data.isCurrent} />
          </section>
          <Trends data={data} />
        </div>
        <aside className="rail" aria-label="Money in and biggest spends">
          <MoneyInPanel data={data} />
          <TopMerchantsPanel merchants={data.topMerchants} month={data.month} />
        </aside>
      </div>
    </div>
  );
}

function MoneyInPanel({ data }) {
  const { incomeFrom, paidBackFrom, totals, expectedIncome } = data;
  // Compare regular income (one-offs left out) with what you expect, once the month is over or the salary is in.
  const regular = totals.income - totals.oneOff;
  const diff = expectedIncome && totals.income > 0 ? regular - expectedIncome : 0;
  const notes = [
    totals.oneOff > 0 ? <span key="o">{`incl. ${fmtMoney(totals.oneOff)} one-off`}</span> : null,
    Math.abs(diff) >= Math.max(1000, expectedIncome * 0.02)
      ? <span key="d" className={diff < 0 ? 'is-under' : ''}>{`${fmtMoney(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than the ${fmtMoney(expectedIncome)} you expect`}</span> : null,
  ].filter(Boolean);
  const Line = ({ who, what, cents, category, href }) => (
    <li>
      {category === undefined ? <Swatch category="Income" size="sm" /> : <Swatch category={category} size="sm" />}
      <div style={{ minWidth: 0 }}>
        <Link className="who" href={href} style={{ textDecoration: 'none', display: 'block' }}>{tidy(who)}</Link>
        <div className="what">{what}</div>
      </div>
      <span className="amt is-in"><Money cents={cents} sign /></span>
    </li>
  );
  return (
    <section className="panel sec-in" id="paid-back" aria-labelledby="in-h">
      <div className="panel-head"><h2 id="in-h">Money in</h2><span className="panel-total is-in"><Money cents={totals.income + totals.paidBack} sign /></span></div>
      <div className="lines-group">
        <div className="lines-group-head"><Link className="stamp" href="/income" title="Income settings">Income</Link><Money cents={totals.income} /></div>
        {notes.length ? <p className="income-note">{notes.flatMap((n, i) => (i ? [' · ', n] : [n]))}</p> : null}
        {incomeFrom.length ? (
          <ul className="lines">
            {incomeFrom.map((r) => (
              <Line key={r.who} who={r.who} cents={r.cents}
                what={r.count > 1 ? plural(r.count, 'payment') : `paid ${fmtDate(r.lastDate)}`}
                href={txLink({ month: data.month, q: r.who.toLowerCase(), direction: 'in' })} />
            ))}
          </ul>
        ) : <p className="empty-line">{expectedIncome ? `No salary in yet; you expect ${fmtMoney(expectedIncome)}.` : 'No salary booked for this month.'}</p>}
      </div>
      <div className="lines-group">
        <div className="lines-group-head"><span className="stamp">Paid back</span><Money cents={totals.paidBack} /></div>
        {paidBackFrom.length ? (
          <ul className="lines">
            {paidBackFrom.map((r) => (
              <Line key={`${r.who}\u0000${r.category}`} who={r.who} cents={r.cents} category={r.category}
                what={`into ${r.category}${r.count > 1 ? ` · ${r.count}×` : ''}`}
                href={txLink({ month: data.month, category: r.category, direction: 'in' })} />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function TopMerchantsPanel({ merchants, month }) {
  if (!merchants.length) return null;
  return (
    <section className="panel sec-top" aria-labelledby="top-h">
      <div className="panel-head"><h2 id="top-h">Biggest spends</h2></div>
      <ul className="lines">
        {merchants.map((r) => (
          <li key={r.who}>
            <Swatch category={r.category} size="sm" />
            <div style={{ minWidth: 0 }}>
              <Link className="who" href={txLink({ month, q: r.who.toLowerCase() })} style={{ textDecoration: 'none', display: 'block' }}>{tidy(r.who)}</Link>
              <div className="what">{`${look(r.category).label}${r.count > 1 ? ` · ${r.count}×` : ''}`}</div>
            </div>
            <span className="amt"><Money cents={r.cents} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
