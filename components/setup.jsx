'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtMoney, plural } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { Icon } from './ui.jsx';

const CONTROL_PANEL = 'https://enablebanking.com/cp';
const COUNTRIES = [['BE', 'Belgium'], ['NL', 'the Netherlands'], ['LU', 'Luxembourg'], ['FR', 'France'], ['DE', 'Germany'], ['ES', 'Spain'], ['IT', 'Italy'],
  ['AT', 'Austria'], ['PT', 'Portugal'], ['IE', 'Ireland'], ['FI', 'Finland'], ['SE', 'Sweden'], ['DK', 'Denmark'], ['NO', 'Norway'], ['PL', 'Poland'], ['EE', 'Estonia'], ['LV', 'Latvia'], ['LT', 'Lithuania']];

// First start, and whenever something isn't set up yet: what stays on your computer, then four steps.
export function Setup({ state: initial }) {
  const { toast, refresh } = useApp();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(null);
  const eb = state.enableBanking;
  const steps = [
    { key: 'eb', done: eb.configured, title: 'Your Enable Banking application',
      summary: eb.configured ? `Application …${eb.appIdEnd}${eb.source === '.env' ? ' (from .env)' : ''} · ${eb.country}` : 'Free for your own accounts, about 10 minutes' },
    { key: 'bank', done: state.banks.length > 0, title: 'Connect your bank',
      summary: state.banks.length ? `${state.banks.join(', ')} · ${plural(state.transactions, 'transaction')}` : 'Read-only access, approved at your bank.' },
    { key: 'ai', done: state.ai, optional: true, title: 'Sorting with AI (optional)',
      summary: state.ai ? `${state.aiName}` : state.aiChosen ? 'Off' : 'Off' },
    { key: 'income', done: state.income.expected != null || state.income.payers > 0, optional: true, title: 'Your income and payday (optional)',
      summary: state.income.expected != null ? `${fmtMoney(state.income.expected)} a month expected` : state.income.payers ? 'Salary payer chosen' : 'Months run from payday to payday' },
  ];
  const next = steps.find((s) => !s.done && !s.optional)?.key ?? steps.find((s) => !s.done)?.key ?? null;
  const [open, setOpen] = useState(next);

  async function sample(remove) {
    setBusy('sample');
    try {
      setState(await api('/api/setup/sample', { method: 'POST', body: { remove } }));
      toast(remove ? 'Sample data removed' : 'Sample data added · have a look around');
      refresh();
    } catch (err) { toast(err.message); }
    setBusy(null);
  }

  return (
    <div className="setup">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
        </div>
      </div>

      <section className="panel setup-intro">
        <p><b>Everything stays on this computer.</b> No account, no server. Only AI suggestions you ask for send
          merchant names out. <Link className="link-btn" href="/welcome">Open the setup guide</Link></p>
        {state.sample || !state.banks.length ? ( // only useful before your own bank is in
          <div className="setup-sample">
            <span>{state.sample ? 'Sample data is in.' : 'Want to look around first?'}</span>
            <button className="btn btn-sm" type="button" disabled={busy === 'sample'} onClick={() => sample(state.sample)}>
              {busy === 'sample' ? 'One moment…' : state.sample ? 'Remove the sample data' : 'Try with sample data'}
            </button>
            {state.sample ? <Link className="btn btn-sm btn-ghost" href="/">See the Overview</Link> : null}
          </div>
        ) : null}
      </section>

      <ol className="setup-steps">
        {steps.map((s, i) => (
          <li key={s.key} className={`panel setup-step${s.done ? ' is-done' : ''}${open === s.key ? ' is-open' : ''}`}>
            <button className="setup-step-head" type="button" onClick={() => setOpen(open === s.key ? null : s.key)} aria-expanded={open === s.key}>
              <span className="setup-num" aria-hidden="true">{s.done ? <Icon name="check" /> : i + 1}</span>
              <span className="setup-title"><b>{s.title}</b><span>{s.summary}</span></span>
              <span className="setup-state">{s.done ? 'Done' : s.optional ? 'Optional' : 'To do'}</span>
            </button>
            {open === s.key ? (
              <div className="setup-body">
                {s.key === 'eb' ? <EnableBankingStep state={state} onSaved={(st) => { setState(st); setOpen('bank'); toast('Enable Banking is set up'); }} /> : null}
                {s.key === 'bank' ? <BankStep state={state} /> : null}
                {s.key === 'ai' ? <AiStep onSaved={(st) => setState((x) => ({ ...x, ai: st.configured, aiName: st.provider === 'off' ? null : st.name, aiProvider: st.provider, aiChosen: st.chosen }))} /> : null}
                {s.key === 'income' ? <IncomeStep /> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      <Features />
      <Updates />
    </div>
  );
}

const FEATURE_LIST = [
  ['trends', 'Trends', 'Spending pace, charts over the months, money in and the biggest spends'],
  ['savings', 'Savings', 'Your savings accounts on the Overview, and a savings plan'],
  ['cut', 'Where to cut', 'Bills and subscriptions you could pay less for'],
  ['rules', 'Rules', 'The rules that sort your transactions, to change by hand'],
];

// Pages not everyone needs: switched off, they leave the menu (and Savings the Overview).
function Features() {
  const { config, toast, refresh } = useApp();
  const [on, setOn] = useState(config.features);
  async function toggle(key, value) {
    const before = on;
    setOn({ ...on, [key]: value });
    try { await api('/api/features', { method: 'POST', body: { [key]: value } }); refresh(); } catch (err) { setOn(before); toast(err.message); }
  }
  return (
    <section className="panel setup-features" aria-labelledby="features-h">
      <div className="panel-head"><h2 id="features-h">Features</h2></div>
      <ul className="feature-list">
        {FEATURE_LIST.map(([key, label, what]) => (
          <li key={key}>
            <label className="check">
              <input type="checkbox" checked={on[key]} onChange={(e) => toggle(key, e.target.checked)} />
              <span><b>{label}</b><span className="sub">{what}</span></span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Is there a newer version on GitHub? In the desktop app: update and restart (backed up first, and back to the
// version you had if anything fails). In a browser: git pull, then restart npm run ui.
function Updates() {
  const { toast } = useApp();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  async function check() {
    setBusy('check'); setError(null);
    try { setInfo(await api('/api/update')); } catch (err) { setError(err.message); }
    setBusy(null);
  }
  useEffect(() => { check(); }, []);
  async function update() {
    setBusy('update');
    try { await api('/api/update', { method: 'POST' }); toast('Updating: Munto closes and opens again in a minute or two'); } catch (err) { setError(err.message); setBusy(null); }
  }
  return (
    <section className="panel setup-updates" id="updates" aria-labelledby="updates-h">
      <div className="panel-head">
        <h2 id="updates-h">Updates</h2>
        <span className="sub">{info ? `Version ${info.version}${info.local ? ` · ${info.local}` : ''}` : ''}</span>
      </div>
      {!info ? <p className="sub">{busy === 'check' ? 'Checking GitHub…' : ''}</p>
        : info.behind ? (
          <div className="setup-body" style={{ padding: 0 }}>
            <p><b>{`${info.changeCount ?? info.behind} change${(info.changeCount ?? info.behind) === 1 ? '' : 's'} since your version`}</b>{info.changes.length ? ':' : '.'}</p>
            {info.changes.length ? <ul className="setup-changes">{info.changes.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
            {info.reason ? <p className="sub">{info.reason}</p>
              : info.inApp ? <p className="sub">Munto backs up your data, updates and reopens.</p>
              : <p className="sub">In the browser: run <code>git pull</code>, then restart <code>npm run ui</code>. (The desktop app does this with one button.)</p>}
          </div>
        ) : <p className="setup-note"><Icon name="check" />{info.reason ?? 'You have the latest version.'}</p>}
      <div className="link-row" style={{ marginTop: 10 }}>
        <button className="btn btn-sm" type="button" onClick={check} disabled={!!busy}>{busy === 'check' ? 'Checking…' : 'Check for updates'}</button>
        {info?.canUpdate && info.inApp ? <button className="btn btn-sm btn-ink" type="button" onClick={update} disabled={!!busy}><Icon name="sync" />{busy === 'update' ? 'Updating…' : 'Update and restart'}</button> : null}
      </div>
      {error ? <p className="link-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function EnableBankingStep({ state, onSaved }) {
  const eb = state.enableBanking;
  const [appId, setAppId] = useState('');
  const [key, setKey] = useState(null); // { name, text }
  const [country, setCountry] = useState(eb.country || 'BE');
  const [redirectUrl, setRedirectUrl] = useState(eb.redirectUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const inApp = typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent);

  async function pick(file) {
    setError(null);
    if (!file) return setKey(null);
    if (file.size > 20_000) return setError('That file is too big to be a key: choose the .pem file from Enable Banking');
    setKey({ name: file.name, text: await file.text() });
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onSaved(await api('/api/setup/enable-banking', { method: 'POST', body: { appId, keyPem: key?.text, country, redirectUrl } })); } catch (err) { setError(err.message); }
    setBusy(false);
  }
  const copy = () => navigator.clipboard?.writeText(redirectUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });

  return (
    <>
      {eb.configured ? (
        <p className="setup-note"><Icon name="check" />{`Set up with application …${eb.appIdEnd}${eb.source === '.env' ? ', from your .env file.' : '.'}`}</p>
      ) : null}
      <p>Munto reads your bank through <b>Enable Banking</b>, a licensed service. It's free for your own accounts, with an
        application of your own.</p>
      <ol className="link-steps">
        <li><b>Create a free account</b> at Enable Banking and sign in to the control panel.{' '}
          <button className="link-btn" type="button" onClick={() => window.open(CONTROL_PANEL, inApp ? 'munto-bank' : '_blank')}>Open the control panel</button></li>
        <li>Under <b>API applications</b>, register a new application: environment <b>Production</b>, any name (e.g. “Munto”), and
          as allowed redirect URL exactly <code>{redirectUrl}</code>{' '}
          <button className="link-btn" type="button" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>.</li>
        <li>Enable Banking gives you a <b>private key file</b> (<code>.pem</code>) to download, and an <b>application ID</b>. Keep the file safe.</li>
        <li><b>Activate it for your own accounts</b> (restricted mode, free): the control panel asks you to link the accounts you want to use.</li>
        <li>Fill in the ID and choose the key file here. Munto checks them with Enable Banking before saving.</li>
      </ol>
      <form className="setup-form" onSubmit={save}>
        <label className="field-col"><span>Application ID</span>
          <input type="text" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" spellCheck={false} autoComplete="off" /></label>
        <label className="field-col"><span>Private key file</span>
          <input type="file" accept=".pem,application/x-pem-file,text/plain" onChange={(e) => pick(e.target.files?.[0])} /></label>
        <label className="field-col"><span>Country of your banks</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select></label>
        <details className="setup-advanced">
          <summary>Redirect URL</summary>
          <label className="field-col"><span>Must be exactly the one on your application</span>
            <input type="text" value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} spellCheck={false} /></label>
        </details>
        <div className="link-row">
          <button className="btn btn-ink" type="submit" disabled={busy || !appId.trim() || !key}><Icon name="check" />{busy ? 'Checking with Enable Banking…' : 'Check and save'}</button>
          {key ? <span className="sub">{key.name}</span> : null}
        </div>
        <p className="sub">Saved in your data folder, readable only by you.</p>
        {error ? <p className="link-error" role="alert">{error}</p> : null}
      </form>
    </>
  );
}

function BankStep({ state }) {
  if (!state.enableBanking.configured) return <p>First set up your Enable Banking application (step 1).</p>;
  return (
    <>
      <p>Approve read-only access at your bank, for up to 180 days. PayPal works the same way.</p>
      <div className="link-row"><Link className="btn btn-ink" href="/accounts?connect=1"><Icon name="bank" />{state.banks.length ? 'Connect another bank' : 'Connect a bank'}</Link></div>
    </>
  );
}

// Which AI sorts what your rules don't: Claude Code, the Claude API, OpenAI, Gemini, Perplexity, Ollama, or off. Keys are
// saved in your data folder and only ever sent to that provider; the page only ever sees their last 4 characters.
export function AiStep({ onSaved }) {
  const { toast } = useApp();
  const [status, setStatus] = useState(null);
  const [provider, setProvider] = useState(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState(null);
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [sendAmounts, setSendAmounts] = useState(true);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null); // { ok, text }
  const inApp = typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent);

  useEffect(() => {
    api('/api/ai').then((st) => { setStatus(st); setProvider(st.chosen ? st.provider : null); setModel(st.model ?? ''); setOllamaUrl(st.ollamaUrl); setSendAmounts(st.sendAmounts); setAuto(st.auto); }).catch((err) => setResult({ ok: false, text: err.message }));
  }, []);
  const p = status?.providers.find((x) => x.id === provider);
  const body = () => ({ provider, model: model.trim(), key: key.trim() || undefined, ollamaUrl, sendAmounts, auto });

  async function loadModels() {
    setBusy('models'); setResult(null);
    try {
      const { models: list } = await api('/api/ai/models', { method: 'POST', body: body() });
      setModels(list);
      if (!list.includes(model)) setModel(status.models[provider] && list.includes(status.models[provider]) ? status.models[provider] : (list[0] ?? ''));
      if (!list.length) setResult({ ok: false, text: provider === 'ollama' ? 'Ollama has no models yet: run `ollama pull llama3.2` (or another) first' : 'No models found for this key' });
    } catch (err) { setResult({ ok: false, text: err.message }); }
    setBusy(null);
  }
  useEffect(() => {
    setModels(null); setResult(null); setKey('');
    if (!status || !provider || provider === 'off') return;
    setModel(status.models[provider] ?? (provider === 'claude-code' ? 'sonnet' : provider === 'anthropic' ? 'claude-opus-5-5' : ''));
    const hasKey = !p?.needsKey || status.keys[provider];
    if (hasKey && provider !== 'claude-code') loadModels();
    if (provider === 'claude-code') setModels(['sonnet', 'opus', 'haiku']);
  }, [provider, status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function test() {
    setBusy('test'); setResult(null);
    try { await api('/api/ai/test', { method: 'POST', body: body() }); setResult({ ok: true, text: 'It works: it answered in the right format.' }); } catch (err) { setResult({ ok: false, text: err.message }); }
    setBusy(null);
  }
  async function save() {
    setBusy('save');
    try { const st = await api('/api/ai', { method: 'POST', body: body() }); setStatus(st); setKey(''); onSaved(st); toast(provider === 'off' ? 'AI is off' : `${st.name} sorts what your rules don’t`); } catch (err) { setResult({ ok: false, text: err.message }); }
    setBusy(null);
  }

  if (!status) return <p className="sub">Loading…</p>;
  const needsKey = p?.needsKey;
  const savedKey = status.keys[provider];
  const ready = !!provider && (provider === 'off' || (provider === 'claude-code' ? status.claudeCode : (!needsKey || key.trim() || savedKey) && model.trim()));
  return (
    <>
      <p>Suggests pots, a budget and where to cut. It sees merchant names and amounts, never your IBAN or balances, and
        nothing is saved until you approve it. Ollama keeps it all on this computer.</p>
      <div className="ai-choices" role="radiogroup" aria-label="AI provider">
        {status.providers.map((x) => (
          <label key={x.id} className={`ai-choice${provider === x.id ? ' is-on' : ''}`}>
            <input type="radio" name="ai-provider" value={x.id} checked={provider === x.id} onChange={() => setProvider(x.id)} />
            <span><b>{x.name}</b>
              <span>{x.id === 'claude-code' ? (status.claudeCode ? 'Installed · on your Claude subscription, no key' : 'Not installed on this computer')
                : x.id === 'off' ? 'Rules and sorting by hand do everything'
                : x.id === 'ollama' ? 'Free, runs on this computer: nothing leaves it'
                : `With an API key · pay per use (cents a month here)${status.keys[x.id] ? ` · key …${status.keys[x.id].slice(-4)} saved` : ''}`}</span></span>
          </label>
        ))}
      </div>

      {provider && provider !== 'off' ? (
        <div className="setup-form">
          <p className="setup-sent">{`Sent to: ${p.sentTo}.`}</p>
          {provider === 'claude-code' && !status.claudeCode ? (
            <p>Install Claude Code from claude.com/claude-code, run <code>claude</code> once to log in with your Claude subscription, then restart Munto.</p>
          ) : null}
          {needsKey ? (
            <label className="field-col"><span>{`${p.name} key`}</span>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={savedKey ? `Saved (…${savedKey.slice(-4)}): type a new one to replace it` : p.keyHint} autoComplete="off" spellCheck={false} />
              {p.keysUrl ? <button className="link-btn" type="button" onClick={() => window.open(p.keysUrl, inApp ? 'munto-bank' : '_blank')} style={{ justifySelf: 'start' }}>Get a key</button> : null}
            </label>
          ) : null}
          {provider === 'ollama' ? (
            <label className="field-col"><span>Ollama address</span>
              <input type="text" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} spellCheck={false} /></label>
          ) : null}
          {provider !== 'claude-code' || status.claudeCode ? (
            <label className="field-col"><span>Model</span>
              {models?.length ? (
                <select value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              ) : (
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="the model’s name" spellCheck={false} />
              )}
              {provider !== 'claude-code' ? <button className="link-btn" type="button" onClick={loadModels} disabled={busy === 'models' || (needsKey && !key.trim() && !savedKey)} style={{ justifySelf: 'start' }}>
                {busy === 'models' ? 'Loading the models…' : 'Load the models'}</button> : null}
            </label>
          ) : null}
          <fieldset className="setup-privacy">
            <legend>When sorting</legend>
            <label className="check"><input type="checkbox" checked={sendAmounts} onChange={(e) => setSendAmounts(e.target.checked)} />
              <span>Include the amounts <span className="sub">(off: only names, descriptions, and whether money went in or out)</span></span></label>
            <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <span>Ask as soon as there’s something to sort <span className="sub">(off: only when you click Ask)</span></span></label>
          </fieldset>
        </div>
      ) : null}

      <div className="link-row">
        {provider && provider !== 'off' ? <button className="btn" type="button" onClick={test} disabled={!ready || !!busy}>{busy === 'test' ? 'Testing…' : 'Test'}</button> : null}
        <button className="btn btn-ink" type="button" onClick={save} disabled={!ready || !!busy}><Icon name="check" />{busy === 'save' ? 'Saving…' : 'Save'}</button>
      </div>
      {result ? <p className={result.ok ? 'setup-note' : 'link-error'} role={result.ok ? 'status' : 'alert'}>{result.ok ? <Icon name="check" /> : null}{result.text}</p> : null}
      <p className="sub">Keys stay in your data folder and only go to that provider.</p>
    </>
  );
}

function IncomeStep() {
  return (
    <>
      <p>Who pays your salary, so months run from payday to payday.</p>
      <div className="link-row"><Link className="btn" href="/income"><Icon name="income" />Income settings</Link></div>
    </>
  );
}
