'use client';
// Hand-drawn SVG charts: the pace line, the Trends card (breakdown donut, bars, calendar).
import { useState } from 'react';
import Link from 'next/link';
import { look } from '@/lib/look.js';
import { addDaysIso, avg, fmtDay, fmtMoney, fmtMonth, fmtShort, niceStep, plural, previousMonth, signed, txLink } from '@/lib/format.js';
import { tipHandlers, useApp } from './app.jsx';
import { Money, Segmented, usePref, useWidth } from './ui.jsx';

// Rounded so the server and the browser draw identical paths (trig can differ in the last digit).
const r2 = (v) => Math.round(v * 100) / 100;
const axisMoney = (v) => `${v < 0 ? '−' : ''}€${(Math.abs(v) / 100).toLocaleString('nl-BE')}`;

// ---------- pace: cumulative spending since payday, this month against last ----------

export function PaceChart({ pace, month, isCurrent }) {
  const { tip } = useApp();
  const [ref, measured] = useWidth(360);
  const [hoverDay, setHoverDay] = useState(null);
  const { current, previous } = pace;
  const today = current.values.length;
  const nowValue = current.values.at(-1) ?? 0;
  const prevAtSameDay = previous.values[Math.min(today, previous.values.length) - 1] ?? null;
  const delta = prevAtSameDay != null ? nowValue - prevAtSameDay : null;
  const prevName = fmtMonth(previousMonth(month), 'long').split(' ')[0];
  const thisName = fmtMonth(month, 'long').split(' ')[0];

  const width = Math.max(240, measured);
  const height = 150;
  const m = { top: 8, right: 10, bottom: 20, left: 44 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const days = current.days;
  const prevValues = previous.values.slice(0, days);
  const max = Math.max(1, ...current.values, ...prevValues);
  const step = niceStep(max / 100, 3) * 100;
  const top = Math.ceil(max / step) * step;
  const x = (day) => r2(m.left + ((day - 1) / Math.max(1, days - 1)) * innerW);
  const y = (v) => r2(m.top + innerH - (Math.max(0, v) / top) * innerH);
  const path = (values) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dateOf = (d) => fmtShort(addDaysIso(current.start, d - 1));
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  function move(ev) {
    const r = ev.currentTarget.ownerSVGElement.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width;
    const day = Math.min(days, Math.max(1, Math.round(((px - m.left) / innerW) * (days - 1)) + 1));
    setHoverDay(day);
    const rows = [];
    if (current.values[day - 1] != null) rows.push({ color: 'var(--ink)', value: fmtMoney(current.values[day - 1]), label: thisName });
    if (prevValues[day - 1] != null) rows.push({ color: 'var(--muted)', value: fmtMoney(previous.values[day - 1]), label: prevName });
    tip.show(ev, `Day ${day} · ${dateOf(day)}`, rows);
  }

  return (
    <div className="pace">
      <div className="pace-head">
        <h2>Pace</h2>
        <div className="legend"><span><i />{fmtMonth(month, 'short')}</span><span><i className="dash" />{prevName.slice(0, 3)}</span></div>
      </div>
      {delta != null && previous.values.length ? (
        <div className="pace-note">
          <span className={delta > 0 ? 'is-over' : 'is-in'}>{`${fmtMoney(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'}`}</span>{` than ${prevName}${isCurrent ? ' so far' : ''}`}
        </div>
      ) : null}
      <div className="chart" ref={ref}>
        {days > 0 && (
          <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={`Cumulative spending by day in ${fmtMonth(month)}, compared with ${prevName}`}>
            {ticks.map((v) => (
              <g key={v}>
                <line className={v === 0 ? 'base' : 'grid'} x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} />
                <text x={m.left - 6} y={y(v) + 3.5} textAnchor="end">{axisMoney(v)}</text>
              </g>
            ))}
            {[1, Math.round(days / 2), days].map((d) => (
              <text key={d} x={x(d)} y={height - 4} textAnchor={d === 1 ? 'start' : d === days ? 'end' : 'middle'}>{dateOf(d)}</text>
            ))}
            {prevValues.length ? <path className="line-prev" d={path(prevValues)} /> : null}
            {current.values.length ? (
              <>
                <path className="area-now" d={`${path(current.values)} L${x(today)},${y(0)} L${x(1)},${y(0)} Z`} />
                <path className="line-now" d={path(current.values)} />
                <circle className="dot-now" cx={x(today)} cy={y(nowValue)} r={4} />
              </>
            ) : null}
            <line className="hover-line" y1={m.top} y2={m.top + innerH} x1={x(hoverDay ?? 1)} x2={x(hoverDay ?? 1)} visibility={hoverDay ? 'visible' : 'hidden'} />
            <rect x={m.left} y={m.top} width={innerW} height={innerH} fill="transparent"
              data-tip="" onPointerDown={move} onPointerMove={move} onPointerLeave={() => { setHoverDay(null); tip.hide(); }} />
          </svg>
        )}
      </div>
    </div>
  );
}

// ---------- trends: one card, several ways to look at the months ----------

const TREND_VIEWS = [['pie', 'Breakdown'], ['inout', 'In & out'], ['pots', 'Pots'], ['saved', 'Saved & left'], ['days', 'Days']];
// Averages leave out a month that is still running, so a half-month doesn't drag them down.
const finished = (data, trend) => trend.filter((t) => !(data.isCurrent && t.month === data.month));
const Key = ({ color, label }) => <span><i className="sq" style={{ background: color }} />{label}</span>;

export function Trends({ data }) {
  const [storedView, setView] = usePref('trendView', 'pie');
  const [storedRange, setRange] = usePref('trendRange', '6');
  const [storedPie, setPie] = usePref('pieMode', 'spending');
  const [focusCat, setFocusCat] = useState(undefined); // one pot picked from the key
  const viewKey = TREND_VIEWS.some(([k]) => k === storedView) ? storedView : 'pie';
  const range = storedRange === '12' ? 12 : 6;
  const pieMode = storedPie === 'income' ? 'income' : 'spending';
  const trend = data.trend.slice(-range);

  const ctx = { focusCat, setFocus: setFocusCat, pieMode, setPieMode: setPie };
  const out = { pie: pieView, inout: inOutView, pots: potsView, saved: savedView, days: daysView }[viewKey](data, trend, ctx);

  return (
    <section className="section sec-trend" aria-labelledby="trend-h">
      <div className="section-head trend-head">
        <h2 id="trend-h">Month by month</h2>
        <div className="trend-controls">
          <Segmented className="trend-tabs" label="Chart" options={TREND_VIEWS} value={viewKey} onChange={(k) => { setView(k); setFocusCat(undefined); }} />
          {viewKey !== 'days' && viewKey !== 'pie' ? (
            <div className="segmented" role="group" aria-label="Months shown">
              {[6, 12].map((n) => <button key={n} type="button" aria-pressed={String(n === range)} aria-label={`${n} months`} onClick={() => setRange(String(n))}>{`${n}m`}</button>)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="trend">
        <div className="trend-top">
          <div className="trend-note">{out.note}</div>
          {out.legend ? <div className="legend trend-legend">{out.legend}</div> : null}
        </div>
        <div className="trend-body">{out.chart}</div>
      </div>
    </section>
  );
}

function inOutView(data, trend) {
  const done = finished(data, trend);
  return {
    legend: <><Key color="var(--in-fill)" label="In" /><Key color="var(--ink)" label="Spent" /></>,
    note: <>{`${plural(done.length, 'month')} · on average `}<b className="is-in">{fmtMoney(avg(done.map((t) => t.income - t.oneOff)))}</b>{done.some((t) => t.oneOff) ? ' regular income, ' : ' in, '}
      <b>{fmtMoney(avg(done.map((t) => t.spent)))}</b>{' spent'}{done.length < trend.length ? ' (finished months)' : ''}</>,
    chart: <BarChart trend={trend} month={data.month} aria="Money in and spent per month"
      series={[{ label: 'In', color: 'var(--in-fill)', value: (t) => t.income }, { label: 'Spent', color: 'var(--ink)', value: (t) => t.spent }]}
      tip={(t) => [{ color: 'var(--in-fill)', value: fmtMoney(t.income), label: 'In' }, { color: 'var(--ink)', value: fmtMoney(t.spent), label: 'Spent' }, { value: signed(t.left), label: 'Left' }]} />,
  };
}

function savedView(data, trend) {
  const done = finished(data, trend);
  const income = done.reduce((a, t) => a + t.income, 0);
  const saved = done.reduce((a, t) => a + t.saved, 0);
  const rate = income > 0 ? Math.round((saved / income) * 100) : null;
  const leftColor = (v) => (v < 0 ? 'var(--over-fill)' : 'var(--ink)');
  return {
    legend: <><Key color="var(--in-fill)" label="Saved" /><Key color="var(--ink)" label="Left" /><Key color="var(--over-fill)" label="Short" /></>,
    note: rate == null ? 'No income in these months yet.'
      : <><b className="is-in">{`${rate}%`}</b>{` of income saved over the last ${plural(done.length, 'finished month')} · `}<b>{fmtMoney(avg(done.map((t) => t.saved)))}</b>{' a month'}</>,
    chart: <BarChart trend={trend} month={data.month} aria="Saved and left over per month"
      series={[{ label: 'Saved', color: 'var(--in-fill)', value: (t) => t.saved }, { label: 'Left', color: leftColor, value: (t) => t.left }]}
      tip={(t) => [
        { color: 'var(--in-fill)', value: signed(t.saved), label: t.income > 0 ? `Saved · ${Math.round((t.saved / t.income) * 100)}% of income` : 'Saved' },
        { color: leftColor(t.left), value: signed(t.left), label: 'Left' }]} />,
  };
}

function potsView(data, trend, { focusCat, setFocus }) {
  // The six biggest pots over the months shown; everything else is one "Rest" layer.
  const totals = new Map();
  for (const t of trend) for (const [c, v] of Object.entries(t.byCategory)) totals.set(c, (totals.get(c) ?? 0) + v);
  const ranked = [...totals].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const top = ranked.slice(0, 6);
  const catOf = (c) => (c === '' ? null : c);
  const series = top.map((c) => ({ label: look(catOf(c)).label, color: look(catOf(c)).color, value: (t) => t.byCategory[c] ?? 0 }));
  if (ranked.length > 6) {
    series.push({ label: 'Rest', color: 'var(--rule-strong)', value: (t) => ranked.slice(6).reduce((a, c) => a + Math.max(0, t.byCategory[c] ?? 0), 0) });
  }
  const legend = (
    <>
      {top.map((c) => (
        <button key={c} type="button" className="legend-pick" aria-pressed={String(focusCat === c)} onClick={() => setFocus(focusCat === c ? undefined : c)}>
          <i className="sq" style={{ background: look(catOf(c)).color }} />{look(catOf(c)).label}
        </button>
      ))}
      {ranked.length > 6 ? <Key color="var(--rule-strong)" label="Rest" /> : null}
    </>
  );

  if (focusCat !== undefined) {
    const l = look(catOf(focusCat));
    const mean = avg(finished(data, trend).map((t) => t.byCategory[focusCat] ?? 0));
    const now = trend.find((t) => t.month === data.month)?.byCategory[focusCat] ?? 0;
    return {
      legend,
      note: <><b>{l.label}</b>{': '}<b>{fmtMoney(mean)}</b>{` a month on average · ${fmtMonth(data.month, 'long').split(' ')[0]} `}
        <b className={mean > 0 && now > mean * 1.15 ? 'is-over' : ''}>{fmtMoney(now)}</b></>,
      chart: <BarChart trend={trend} month={data.month} average={mean} aria={`${l.label} per month`}
        series={[{ label: l.label, color: l.color, value: (t) => t.byCategory[focusCat] ?? 0 }]}
        tip={(t) => [{ color: l.color, value: fmtMoney(t.byCategory[focusCat] ?? 0), label: l.label }, { value: fmtMoney(mean), label: 'average' }]}
        pickHref={(t) => (catOf(focusCat) ? txLink({ month: t.month, category: focusCat }) : '/review')} />,
    };
  }
  return {
    legend,
    note: top.length
      ? <>{'Biggest: '}<b>{look(catOf(top[0])).label}</b>{`, ${fmtMoney(avg(finished(data, trend).map((t) => t.byCategory[top[0]] ?? 0)))} a month · tap one in the key to see it alone`}</>
      : 'No spending yet.',
    chart: <BarChart trend={trend} month={data.month} stacked aria="Spending per pot per month" series={series}
      tip={(t) => series.map((se) => ({ color: se.color, value: fmtMoney(se.value(t)), label: se.label, raw: se.value(t) }))
        .filter((r) => r.raw > 0).sort((a, b) => b.raw - a.raw).concat([{ value: fmtMoney(t.spent), label: 'Spent in all' }])} />,
  };
}

// Columns per month: side by side (and below zero when negative), or stacked. Each month is one
// hover/click target that opens that month (or pickHref).
export function BarChart({ trend, month, series, stacked = false, average = null, averageLabel = 'avg', aria, tip: tipRows, pickHref }) {
  const { tip, router } = useApp();
  const [ref, measured] = useWidth(600);
  const colorOf = (se, v) => (typeof se.color === 'function' ? se.color(v) : se.color);
  const width = Math.max(280, measured);
  const height = 220;
  const m = { top: 12, right: 6, bottom: 24, left: 58 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const vals = trend.map((t) => series.map((se) => se.value(t)));
  const hi = Math.max(1, average ?? 0, ...(stacked ? vals.map((v) => v.reduce((a, b) => a + Math.max(0, b), 0)) : vals.flat()));
  const lo = stacked ? 0 : Math.min(0, ...vals.flat());
  const step = niceStep((hi - lo) / 100) * 100;
  const top = Math.ceil(hi / step) * step;
  const bottom = Math.floor(lo / step) * step;
  const y = (v) => r2(m.top + innerH - ((v - bottom) / (top - bottom)) * innerH);
  // A bar from one value to another, rounded at the far end.
  const bar = (key, x, w, from, to, color, round = true, className) => {
    const a = y(from); const b = y(to);
    const len = Math.abs(a - b);
    if (len < 0.5) return null;
    const r = round ? Math.min(3, len / 2, w / 2) : 0;
    const dir = b < a ? 1 : -1;
    return <path key={key} className={className} style={{ fill: color }} pointerEvents="none"
      d={`M${x},${a} V${b + dir * r} Q${x},${b} ${x + r},${b} H${x + w - r} Q${x + w},${b} ${x + w},${b + dir * r} V${a} Z`} />;
  };
  const ticks = [];
  for (let v = bottom; v <= top; v += step) ticks.push(v);
  const band = r2(innerW / trend.length);
  const cols = stacked ? 1 : series.length;
  const gap = 2;
  const barW = r2(Math.max(4, Math.min(stacked || cols === 1 ? 30 : 24, (band - 12 - gap * (cols - 1)) / cols)));

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={aria}>
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? 'base' : 'grid'} x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} />
            <text x={m.left - 8} y={y(v) + 4} textAnchor="end">{axisMoney(v)}</text>
          </g>
        ))}
        {trend.map((t, i) => {
          const x0 = m.left + i * band;
          const cx = x0 + band / 2;
          const current = t.month === month;
          const open = () => router.push(pickHref ? pickHref(t) : `/?month=${t.month}`);
          let bars;
          if (stacked) {
            const parts = series.map((se, j) => [se, Math.max(0, vals[i][j])]).filter(([, v]) => v > 0);
            let acc = 0;
            bars = parts.map(([se, v], k) => {
              const seg = bar(k, cx - barW / 2, barW, acc, acc + v, colorOf(se, v), k === parts.length - 1, k < parts.length - 1 ? 'seg' : undefined);
              acc += v;
              return seg;
            });
          } else {
            const x = r2(cx - (cols * barW + (cols - 1) * gap) / 2);
            bars = series.map((se, j) => bar(j, x + j * (barW + gap), barW, 0, vals[i][j], colorOf(se, vals[i][j])));
          }
          return (
            <g key={t.month}>
              <rect className={`band${current ? ' is-current' : ''}`} x={x0 + 2} y={m.top} width={band - 4} height={innerH} rx={6} tabIndex={0} role="link"
                aria-label={`${fmtMonth(t.month)}: ${series.map((se, j) => `${se.label} ${fmtMoney(vals[i][j])}`).join(', ')}`}
                onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
                {...tipHandlers(tip, (e) => tip.show(e, fmtMonth(t.month), tipRows(t)))} />
              {bars}
              <text x={cx} y={height - 6} textAnchor="middle" className={current ? 'is-current' : undefined}>{fmtMonth(t.month, 'short')}</text>
            </g>
          );
        })}
        {average ? (
          <>
            <line className="avg-line" x1={m.left} x2={width - m.right} y1={y(average)} y2={y(average)} pointerEvents="none" />
            <text className="avg-label" x={width - m.right} y={y(average) - 5} textAnchor="end">{`${averageLabel} ${fmtMoney(average)}`}</text>
          </>
        ) : null}
      </svg>
    </div>
  );
}

// ---------- breakdown: a donut of this month ----------

// Spending per pot, or where the income went (spent, saved, left).
function pieView(data, trend, { pieMode, setPieMode }) {
  return {
    note: (
      <>
        <Segmented className="pie-modes" label="Breakdown of" options={[['spending', 'Spending'], ['income', 'Income']]} value={pieMode} onChange={setPieMode} />
        <PieNote data={data} pieMode={pieMode} />
      </>
    ),
    chart: <Donut data={data} pieMode={pieMode} />,
  };
}

function pieSlices(data, pieMode, transferCategory) {
  const { totals, month } = data;
  let slices;
  if (pieMode === 'income') {
    slices = [
      { label: 'Spent', color: 'var(--ink)', value: Math.max(0, totals.spent), href: txLink({ month, direction: 'out' }) },
      { label: 'Saved', color: 'var(--in-fill)', value: Math.max(0, totals.saved), href: txLink({ month, category: transferCategory }) },
      { label: 'Left', color: 'var(--rule-strong)', value: Math.max(0, totals.left) },
    ];
  } else {
    // Pots under 2% of spending share one "Rest" slice (when there are several) so the ring stays readable.
    const parts = data.pots.filter((e) => e.net > 0);
    const total = parts.reduce((a, e) => a + e.net, 0);
    let big = parts.filter((e) => e.net / total >= 0.02);
    let small = parts.filter((e) => e.net / total < 0.02);
    if (small.length < 2) { big = parts; small = []; }
    slices = big.map((e) => ({ label: look(e.category).label, color: look(e.category).color, value: e.net, href: e.category ? txLink({ month, category: e.category }) : '/review' }));
    if (small.length) slices.push({ label: `Rest (${small.length})`, color: 'var(--rule-strong)', value: small.reduce((a, e) => a + e.net, 0) });
  }
  return slices.filter((sl) => sl.value > 0);
}

function PieNote({ data, pieMode }) {
  const { config } = useApp();
  const { totals } = data;
  const slices = pieSlices(data, pieMode, config.transferCategory);
  const sum = slices.reduce((a, sl) => a + sl.value, 0);
  if (!sum) return null;
  const pct = (v) => Math.round((v / sum) * 100);
  if (pieMode === 'income') {
    return (
      <span className="pie-note">
        <b>{`${pct(totals.spent)}%`}</b>{' spent, '}<b className="is-in">{`${pct(Math.max(0, totals.saved))}%`}</b>{' saved'}
        {totals.left < 0 ? <>{', '}<b className="is-over">{fmtMoney(-totals.left)}</b>{' more out than came in'}</> : <>{', '}<b>{`${pct(totals.left)}%`}</b>{' left'}</>}
      </span>
    );
  }
  return null; // the key beside the donut already gives each slice's share
}

function Donut({ data, pieMode }) {
  const { config, router } = useApp();
  const [focus, setFocus] = useState(null);
  const { totals, month } = data;
  const monthName = fmtMonth(month, 'long').split(' ')[0];
  const slices = pieSlices(data, pieMode, config.transferCategory);
  const sum = slices.reduce((a, sl) => a + sl.value, 0);
  if (!sum) return <p className="sub">{pieMode === 'income' ? 'No income this month yet.' : 'No spending this month yet.'}</p>;
  const pct = (v) => Math.round((v / sum) * 100);

  const size = 240; const R = 112; const r = 72; const c = size / 2;
  const point = (a, rad) => [r2(c + rad * Math.sin(a)), r2(c - rad * Math.cos(a))];
  const arc = (a0, a1) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = point(a0, R); const [x1, y1] = point(a1, R);
    const [x2, y2] = point(a1, r); const [x3, y3] = point(a0, r);
    return `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`;
  };
  const gap = slices.length > 1 ? 0.012 : 0;
  let a = 0;
  const arcs = slices.map((sl) => {
    const a0 = a; a += (sl.value / sum) * Math.PI * 2;
    return slices.length === 1
      ? `M${c},${c - R} A${R},${R} 0 1 1 ${c - 0.01},${c - R} L${c - 0.01},${c - r} A${r},${r} 0 1 0 ${c},${c - r} Z`
      : arc(a0 + gap / 2, a - gap / 2);
  });
  const potCount = data.pots.filter((e) => e.net > 0).length;
  const center = focus != null
    ? [slices[focus].label, fmtMoney(slices[focus].value), `${pct(slices[focus].value)}%`]
    : pieMode === 'income'
      ? [`${monthName} income`, fmtMoney(totals.income), totals.left < 0 ? `${fmtMoney(-totals.left)} short` : `${pct(Math.max(0, totals.left))}% left`]
      : [`Spent in ${monthName}`, fmtMoney(sum), plural(potCount, 'pot')];
  const hover = (i) => ({ onPointerEnter: () => setFocus(i), onPointerLeave: () => setFocus(null) });

  return (
    <div className="pie-wrap">
      <div className="pie-ring">
        <svg className={`pie${focus != null ? ' has-focus' : ''}`} viewBox={`0 0 ${size} ${size}`} role="img"
          aria-label={`${pieMode === 'income' ? 'Where the income went' : 'Spending per pot'} in ${fmtMonth(month)}`}>
          {slices.map((sl, i) => (
            <path key={sl.label} d={arcs[i]} style={{ fill: sl.color }} className={`pie-slice${sl.href ? ' is-link' : ''}${focus === i ? ' is-focus' : ''}`}
              tabIndex={sl.href ? 0 : -1} aria-label={`${sl.label}: ${fmtMoney(sl.value)}, ${pct(sl.value)}%`}
              {...hover(i)} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)}
              onClick={() => sl.href && router.push(sl.href)} onKeyDown={(e) => { if (e.key === 'Enter' && sl.href) router.push(sl.href); }} />
          ))}
          <text className="pie-center-label" x={c} y={c - 12} textAnchor="middle">{center[0]}</text>
          <text className="pie-center-value" x={c} y={c + 14} textAnchor="middle">{center[1]}</text>
          <text className="pie-center-label" x={c} y={c + 34} textAnchor="middle">{center[2]}</text>
        </svg>
      </div>
      <ul className="pie-list">
        {slices.map((sl, i) => (
          <li key={sl.label} className={focus === i ? 'is-focus' : undefined} {...hover(i)}>
            <i className="sq" style={{ background: sl.color }} />
            {sl.href
              ? <Link href={sl.href} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)}>{sl.label}</Link>
              : <span className="pie-name">{sl.label}</span>}
            <span className="pie-amt"><Money cents={sl.value} /></span>
            <span className="pie-pct">{`${pct(sl.value)}%`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- days: a calendar of the month since payday, darker for days you spent more ----------

function daysView(data) {
  const { start, values } = data.pace.current;
  const perDay = values.map((v, i) => v - (i ? values[i - 1] : 0));
  const max = Math.max(1, ...perDay);
  const quiet = perDay.filter((v) => v <= 0).length;
  const biggest = perDay.indexOf(Math.max(...perDay));
  return {
    legend: <span className="cal-scale">Less{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`cal-sw l${l}`} />)}More</span>,
    note: values.length
      ? <><b>{fmtMoney(avg(perDay))}</b>{' a day · '}<b>{String(quiet)}</b>{` ${quiet === 1 ? 'day' : 'days'} without spending`}
        {biggest >= 0 && perDay[biggest] > 0 ? <>{' · biggest '}<b>{fmtMoney(perDay[biggest])}</b>{` on ${fmtShort(addDaysIso(start, biggest))}`}</> : null}</>
      : `Nothing booked since ${data.period.payday ? 'payday' : 'the 1st'} yet.`,
    chart: <Calendar pace={data.pace.current} perDay={perDay} max={max} biggest={biggest} />,
  };
}

function Calendar({ pace, perDay, max, biggest }) {
  const { tip } = useApp();
  const { start, days, values } = pace;
  const level = (v) => (v <= 0 ? 0 : Math.max(1, Math.ceil(Math.sqrt(v / max) * 4)));
  const lead = (new Date(start + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday first
  return (
    <div className="cal" role="grid" aria-label={`Spending per day since ${fmtShort(start)}`}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="cal-dow" aria-hidden="true">{d}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={`pad${i}`} className="cal-pad" />)}
      {Array.from({ length: days }, (_, i) => {
        const iso = addDaysIso(start, i);
        const dom = Number(iso.slice(8));
        if (i >= values.length) return <span key={iso} className="cal-day is-future" aria-hidden="true"><span className="cal-n">{dom}</span></span>;
        const v = perDay[i];
        return (
          <Link key={iso} className={`cal-day l${level(v)}${i === biggest && v > 0 ? ' is-top' : ''}`} href={txLink({ day: iso })}
            aria-label={`${fmtDay(iso)}: ${v > 0 ? fmtMoney(v) + ' spent' : v < 0 ? signed(-v) + ' back' : 'nothing spent'}`}
            {...tipHandlers(tip, (e) => tip.show(e, fmtDay(iso), [{ value: v > 0 ? fmtMoney(v) : v < 0 ? signed(-v) : '€ 0', label: v > 0 ? 'spent' : v < 0 ? 'came back' : 'no spending' }]))}>
            <span className="cal-n">{dom}</span>
            {v > 0 ? <span className="cal-v">{`€${Math.round(v / 100)}`}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}
