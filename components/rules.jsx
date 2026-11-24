'use client';
import { useState } from 'react';
import { fmtIban, fmtMoney, parseEuros, ruleWords } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { Dot, Icon, Swatch } from './ui.jsx';

export function Rules() {
  const { config, toast, refresh } = useApp();
  const [newCategory, setNewCategory] = useState('');
  const [ruleText, setRuleText] = useState('');
  const [ruleCategory, setRuleCategory] = useState('');
  const [ruleAmount, setRuleAmount] = useState('');
  const [filter, setFilter] = useState('');

  // Runs a change, then re-renders from the server (the layout reloads the config).
  const submit = (fn) => async (e) => {
    e?.preventDefault();
    try { await fn(); refresh(); } catch (err) { if (err.message !== 'Cancelled') toast(err.message); }
  };

  const rules = config.rules.map((r, i) => ({ r, i })).filter(({ r }) => !filter || `${r.match} ${r.category}`.toLowerCase().includes(filter));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Rules</h1>
          <p className="sub" style={{ marginTop: 4 }}>The first match wins; rules with an amount go first. A word with a dark edge only counts as a whole word.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Pots</h2></div>
        <div className="cat-chips">{config.categories.map((c) => <span className="cat-chip" key={c}><Swatch category={c} size="sm" />{c}</span>)}</div>
        <form className="inline-form" onSubmit={submit(async () => {
          await api('/api/categories', { method: 'POST', body: { name: newCategory } });
          toast(`Added ${newCategory}`);
          setNewCategory('');
        })}>
          <input type="text" placeholder="New category" aria-label="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          <button className="btn" type="submit">Add pot</button>
        </form>
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>{`Rules (${config.rules.length})`}</h2>
          <label className="search"><Icon name="search" /><input type="search" placeholder="Filter rules" aria-label="Filter rules" value={filter} onChange={(e) => setFilter(e.target.value.toLowerCase())} /></label>
        </div>
        <ol className="rule-list">
          {rules.map(({ r, i }) => (
            <li className="rule-row" key={`${i}:${r.match}`}>
              <span className="rule-n">{i + 1}</span>
              <span className="rule-words" aria-label={`Matches ${r.match}`}>
                {ruleWords(r.match).map((w, k) => (
                  <span key={k} className={`rule-word${w.whole ? ' is-whole' : ''}${w.raw ? ' is-raw' : ''}`} title={w.whole ? 'Whole word' : w.raw ? 'A pattern' : undefined}>{w.text}</span>
                ))}
                {r.amountCents != null ? <span className="sub">{`only ${fmtMoney(r.amountCents)}`}</span> : null}
              </span>
              <span className={`rule-dir sub${r.direction ? '' : ' is-both'}`}>{r.direction === 'in' ? 'Money in' : r.direction === 'out' ? 'Money out' : 'In and out'}</span>
              <span className="cat-inline rule-pot"><Dot category={r.category} />{r.category}</span>
              <button className="btn btn-ghost btn-sm rule-del" type="button" aria-label={`Delete rule ${i + 1}`} onClick={submit(async () => {
                await api(`/api/rules/${i}`, { method: 'DELETE', body: {} });
                toast(`Rule ${i + 1} deleted`, {
                  label: 'Undo',
                  run: submit(async () => { await api('/api/rules/restore', { method: 'POST', body: { index: i, rule: r } }); }),
                });
              })}>Delete</button>
            </li>
          ))}
        </ol>
        <form className="inline-form" onSubmit={submit(async () => {
          const amountCents = ruleAmount.trim() ? parseEuros(ruleAmount) : null;
          if (ruleAmount.trim() && !(amountCents > 0)) throw new Error('That amount isn’t a number of euros');
          await api('/api/rules', { method: 'POST', body: { match: ruleText, category: ruleCategory, amountCents } });
          toast('Rule added');
          setRuleText('');
          setRuleAmount('');
        })}>
          <input type="text" placeholder="Contains… (e.g. delhaize)" aria-label="Text the transaction contains" value={ruleText} onChange={(e) => setRuleText(e.target.value)} />
          <input type="text" inputMode="decimal" className="rule-amount" placeholder="Amount (optional)" aria-label="Only payments of this amount (optional)" value={ruleAmount} onChange={(e) => setRuleAmount(e.target.value)} />
          <select aria-label="Category for the new rule" value={ruleCategory} onChange={(e) => setRuleCategory(e.target.value)}>
            <option value="">Category…</option>
            {config.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-ink" type="submit">Add rule</button>
        </form>
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <h2>Your own accounts</h2>
        <p className="sub" style={{ margin: '8px 0 10px' }}>{'Not counted as spending. Your linked accounts are included.'}</p>
        {(config.ownIbans ?? []).length
          ? <div className="cat-chips">{config.ownIbans.map((iban) => <span className="cat-chip" key={iban} style={{ paddingLeft: 12 }}>{fmtIban(iban)}</span>)}</div>
          : <p className="sub">{'None yet.'}</p>}
      </section>

    </div>
  );
}
