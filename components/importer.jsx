'use client';
// Import a bank's CSV export: choose the file, check the columns Munto guessed against a preview of the first
// rows, name the account, import. The file is read here and sent only to Munto's own server on this computer.
import { useState } from 'react';
import { fmtDate, fmtIban, plural } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { Icon, Money } from './ui.jsx';

const MAX_BYTES = 5_000_000;
// [field, label]: the date and an amount (or money out and in) are needed, the rest helps your rules.
const COLUMNS = [
  ['date', 'Date'], ['amount', 'Amount'], ['debit', 'Money out'], ['credit', 'Money in'],
  ['counterparty', 'Who'], ['counterpartyIban', 'Their IBAN'], ['description', 'Description'], ['description2', 'More description'], ['currency', 'Currency'],
  ['account', 'Your IBAN'], // payments to it count as transfers between your own accounts: only when every row has the same one
];

// preset: { name, bank } when importing a newer export into an account you imported before.
export function ImportPanel({ preset = null, onClose }) {
  const { toast, refresh } = useApp();
  const [file, setFile] = useState(null); // { name, text }
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [name, setName] = useState(preset?.name ?? '');
  const [bank, setBank] = useState(preset?.bank ?? '');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function load(text, chosen) {
    setBusy('preview'); setError(null);
    try {
      const p = await api('/api/import/preview', { method: 'POST', body: { text, mapping: chosen } });
      setPreview(p); setMapping(p.mapping);
    } catch (err) { setError(err.message); setPreview(null); }
    setBusy(null);
  }
  async function pick(f) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError('That file is too big: export a shorter period (up to 5 MB)');
    const text = await f.text();
    setFile({ name: f.name, text });
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 80));
    load(text, null);
  }
  function choose(field, value) {
    const next = { ...mapping };
    if (value === '') delete next[field]; else next[field] = Number(value);
    load(file.text, next);
  }
  async function save() {
    setBusy('save'); setError(null);
    try {
      const r = await api('/api/import', { method: 'POST', body: { text: file.text, mapping, name, bank } });
      toast(`${plural(r.added, 'transaction')} imported${r.already ? ` · ${r.already} were already in` : ''}${r.covered ? ` · ${r.covered} come from your bank instead` : ''}`);
      refresh();
      onClose();
    } catch (err) { setError(err.message); setBusy(null); }
  }

  const hasAmount = mapping && (mapping.amount != null || mapping.debit != null || mapping.credit != null);
  const ready = preview && mapping?.date != null && hasAmount && preview.count > 0 && name.trim() && bank.trim();

  return (
    <section className="panel link-panel import-panel" aria-labelledby="import-h">
      <div className="panel-head">
        <h2 id="import-h">{preset ? `Import into ${preset.name}` : 'Import a CSV'}</h2>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Cancel</button>
      </div>
      <div className="link-step">
        <p className="sub">For a bank Enable Banking doesn’t cover, or history from before you linked it. Export the
          transactions as CSV in your bank’s app or website. The file is read on this computer; nothing leaves it.</p>
        <label className="field-col import-file"><span>CSV file</span>
          <input type="file" accept=".csv,text/csv,.txt,text/plain" onChange={(e) => pick(e.target.files?.[0])} /></label>

        {preview ? (
          <>
            <p className="sub">
              {preview.remembered ? 'The columns you chose for this kind of file last time. ' : 'Munto guessed the columns: check them against the preview. '}
              {`${plural(preview.count, 'transaction')}${preview.from ? `, ${fmtDate(preview.from)} to ${fmtDate(preview.to)}` : ''}`}
              {preview.problemCount ? ` · ${plural(preview.problemCount, 'row')} without a date or amount left out` : ''}
            </p>
            <div className="import-columns">
              {COLUMNS.map(([field, label]) => (
                <label key={field} className="field-col"><span>{label}</span>
                  <select value={mapping[field] ?? ''} onChange={(e) => choose(field, e.target.value)} disabled={busy === 'save'}>
                    <option value="">—</option>
                    {preview.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select></label>
              ))}
            </div>
            {preview.sample.length ? (
              <ul className="import-preview" aria-label="The first rows, as they'd be imported">
                {preview.sample.map((t, i) => (
                  <li key={i}>
                    <span className="sub">{fmtDate(t.date)}</span>
                    <span className="import-who"><b>{t.counterparty ?? '—'}</b><span className="sub">{t.description ?? ''}</span></span>
                    <Money cents={t.cents} sign />
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="import-account">
              <label className="field-col"><span>Account name</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Current account" /></label>
              <label className="field-col"><span>Bank</span>
                <input type="text" value={bank} onChange={(e) => setBank(e.target.value)} maxLength={80} placeholder="Your bank’s name" /></label>
            </div>
            {preview.iban ? <p className="sub">{`Account ${fmtIban(preview.iban)} (from the file). Importing it again later only adds what’s new.`}</p> : null}
            <div className="link-row">
              <button className="btn btn-ink" type="button" onClick={save} disabled={!ready || !!busy}>
                <Icon name="check" />{busy === 'save' ? 'Importing…' : `Import ${plural(preview.count, 'transaction')}`}</button>
              {!hasAmount || mapping?.date == null ? <span className="sub">Choose at least the date and the amount.</span>
                : !name.trim() || !bank.trim() ? <span className="sub">Fill in the account name and the bank.</span> : null}
            </div>
          </>
        ) : busy === 'preview' ? <p className="sub">Reading the file…</p> : null}
        {error ? <p className="link-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
