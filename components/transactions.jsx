'use client';
import { useEffect, useRef, useState } from 'react';
import { fmtDay, fmtMoney, tidy, txLink } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { CategoryChip, Icon, Jar, Money, MonthStepper, Segmented, Swatch, useKey } from './ui.jsx';

const hasFilters = (f) => Boolean(f.month || f.category || f.q || f.direction || f.iban || f.day);

export function Transactions({ filters, months, rows }) {
  const { config, router } = useApp();
  const update = (changes) => router.push(txLink({ ...filters, ...changes }));
  const [q, setQ] = useState(filters.q);
  const searchTimer = useRef();
  const searchInput = useRef(null);
  useKey('/', () => searchInput.current?.focus()); // / jumps to the search field
  useEffect(() => setQ(filters.q), [filters.q]);

  // A bank payment that only moved money to PayPal is counted as the PayPal payment, so not in the sums.
  const counted = (t) => t.category_source !== 'mirror';
  const out = rows.filter((t) => t.amount_cents < 0 && counted(t)).reduce((sum, t) => sum - t.amount_cents, 0);
  const inn = rows.filter((t) => t.amount_cents > 0 && counted(t)).reduce((sum, t) => sum + t.amount_cents, 0);

  // Group by day, newest first.
  const days = new Map();
  for (const t of rows) {
    if (!days.has(t.booking_date)) days.set(t.booking_date, []);
    days.get(t.booking_date).push(t);
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-head-left">
          <h1>Transactions</h1>
          <MonthStepper months={months} month={filters.month} onPick={(month) => update({ month, day: '' })} allowAll />
        </div>
      </div>
      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input ref={searchInput} type="search" placeholder="Search merchant or description" aria-label="Search" aria-keyshortcuts="/" value={q}
            onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); update({ q: '' }); } }}
            onChange={(e) => {
              const value = e.target.value;
              setQ(value);
              clearTimeout(searchTimer.current);
              searchTimer.current = setTimeout(() => update({ q: value }), 350);
            }} />
          {q ? null : <kbd className="search-key" aria-hidden="true">/</kbd>}
        </label>
        <select aria-label="Category" value={filters.category} onChange={(e) => update({ category: e.target.value })}>
          <option value="">All categories</option>
          <option value="__none">Unsorted</option>
          {config.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Segmented label="Direction" options={[['', 'All'], ['out', 'Out'], ['in', 'In']]} value={filters.direction} onChange={(direction) => update({ direction })} />
        {hasFilters(filters) ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push('/transactions')}>Clear filters</button> : null}
      </div>
      <div className="summary-line">
        <span><b>{`${rows.length}${rows.length === 1000 ? '+' : ''}`}</b>{' transactions'}{filters.day ? ` on ${fmtDay(filters.day)}` : ''}</span>
        <span>Out <b>{fmtMoney(out)}</b></span>
        <span>In <b className="is-in">{fmtMoney(inn)}</b></span>
      </div>
      {rows.length === 0 ? (
        <div className="empty"><Jar fill={0} className="jar-empty" /><strong>No transactions match</strong>Try another month, category or search.</div>
      ) : (
        <div className="daybook">
          {[...days].map(([day, txs]) => (
            <section className="day" aria-label={fmtDay(day)} key={day}>
              <div className="day-head"><span className="stamp">{fmtDay(day)}</span><Money cents={txs.filter(counted).reduce((sum, t) => sum + t.amount_cents, 0)} sign /></div>
              {txs.map((t) => <TransactionRow key={t.id} t={t} />)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TransactionRow({ t }) {
  const { toast, refresh } = useApp();
  const [category, setCategory] = useState(t.category ?? '');
  useEffect(() => setCategory(t.category ?? ''), [t.category]);
  const title = tidy(t.counterparty) || tidy(t.merchant);

  async function change(next) {
    const previous = category;
    setCategory(next);
    try {
      await api('/api/transactions/category', { method: 'POST', body: { ids: [t.id], category: next || null } });
      refresh();
      if (!next) return toast('Back to unsorted; rules will apply again.');
      toast(`Put in ${next}.`, {
        label: `Always for ${tidy(t.merchant)}`,
        run: async () => {
          try {
            await api('/api/rules', { method: 'POST', body: { match: t.merchant, category: next } });
            toast(`Rule added: ${tidy(t.merchant)} → ${next}`);
            refresh();
          } catch (err) { toast(err.message); }
        },
      });
    } catch (err) {
      setCategory(previous);
      toast(err.message);
    }
  }

  return (
    <div className={`tx${t.category_source === 'mirror' ? ' is-mirror' : ''}`}>
      <Swatch category={category || null} />
      <div className="tx-main">
        <div className="tx-who" title={t.description ? `${title}\n${t.description}` : title}>
          {title}
          {t.status === 'RJCT' ? <span className="pill" title="PayPal reversed it; the refund is its own line">Reversed</span>
            : t.status !== 'BOOK' ? <span className="pill">{t.status === 'PDNG' ? 'Pending' : 'Scheduled'}</span> : null}
          {t.category_source === 'mirror' ? <span className="manual-mark" title="This only moved the money to PayPal. It counts once, as the PayPal payment with the real merchant.">counted in PayPal</span> : null}
          {t.one_off ? <span className="manual-mark" title="One-off income: left out of averages and paydays">one-off</span> : null}
        </div>
      </div>
      {t.category_source === 'mirror'
        ? <span className="tx-mirror">PayPal</span>
        : <CategoryChip label={`Category for ${title}`} value={category} onChange={change} />}
      <div className={`tx-amt${t.amount_cents > 0 ? ' is-in' : ''}`}><Money cents={t.amount_cents} sign /></div>
    </div>
  );
}
