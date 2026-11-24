'use client';
import { useEffect, useRef, useState } from 'react';
import { daysUntil, fmtDate, fmtIban, plural, tidy } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { Icon, Jar, Money, Swatch, SyncButton } from './ui.jsx';
import { ImportPanel } from './importer.jsx';

const isCsv = (a) => a.uid.startsWith('csv-'); // imported from a CSV export (see src/csvimport.js)

export function Accounts({ accounts, connect = false, importing: startImport = false }) {
  const linkedBanks = [...new Set(accounts.filter((a) => !a.uid.startsWith('sample-') && !isCsv(a)).map((a) => a.bank))];
  const [log, setLog] = useState(null);
  const [linking, setLinking] = useState(connect ? '' : null); // null, or the bank to preselect ('' for none)
  const [importing, setImporting] = useState(startImport ? {} : null); // null, or { preset } for an account imported before
  return (
    <div>
      <div className="page-head">
        <div><h1>Accounts</h1></div>
        <div className="sync-row">
          <button className="btn" type="button" onClick={() => { setImporting(null); setLinking(''); }}><Icon name="bank" />Connect a bank</button>
          <button className="btn" type="button" onClick={() => { setLinking(null); setImporting({}); }}>Import a CSV</button>
          <SyncButton onOutput={setLog} />
        </div>
      </div>
      {linking != null ? <LinkPanel preselect={linking} linkedBanks={linkedBanks} onClose={() => setLinking(null)} /> : null}
      {importing != null ? <ImportPanel key={importing.preset?.name ?? ''} preset={importing.preset} onClose={() => setImporting(null)} /> : null}
      {accounts.length ? (
        <div className="accounts">
          {accounts.map((a) => {
            const days = daysUntil(a.valid_until);
            const cls = days <= 0 ? 'is-expired' : days <= 14 ? 'is-warn' : '';
            const label = days <= 0 ? 'Bank access expired: renew it to keep syncing'
              : `Access until ${fmtDate(a.valid_until.slice(0, 10))}`;
            return (
              <section className="panel account" key={a.uid}>
                <div className="env-top">
                  <Swatch category="Savings & transfers" />
                  <div><div className="account-name">{tidy(a.name) || a.bank}</div><div className="sub">{[a.bank, a.iban ? fmtIban(a.iban) : null].filter(Boolean).join(' · ')}</div></div>
                </div>
                <div className="account-balance">{a.balance_cents == null ? '—' : <Money cents={a.balance_cents} />}</div>
                {isCsv(a) ? (
                  <CsvAccount a={a} onImport={() => { setLinking(null); setImporting({ preset: { name: tidy(a.name) || a.bank, bank: a.bank } }); }} />
                ) : (
                  <>
                    <div className={`consent ${cls}`.trim()}>
                      <div className="gauge"><span className="gauge-fill" style={{ '--w': `${Math.max(2, Math.min(100, (days / 180) * 100))}%` }} /></div>
                      <span>{label}</span>
                    </div>
                    <div className="account-meta">
                      <span>{a.last_synced ? `Last synced ${fmtDate(a.last_synced.slice(0, 10))}` : 'Not synced yet'}</span>
                    </div>
                    {!a.uid.startsWith('sample-') && days <= 14 ? ( // only once it's due
                      <div className="account-renew">
                        <button className="btn btn-sm btn-need" type="button" onClick={() => setLinking(a.bank)}>
                          {days <= 0 ? 'Renew access' : `Renew: ${plural(days, 'day')} left`}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            );
          })}
        </div>
      ) : linking == null && importing == null ? (
        <div className="empty"><Jar fill={0} className="jar-empty" /><strong>No accounts linked yet</strong>Connect your bank to bring in your transactions, or import a CSV export from it.
          <div className="empty-actions">
            <button className="btn btn-ink" type="button" onClick={() => setLinking('')}><Icon name="bank" />Connect a bank</button>
            <button className="btn" type="button" onClick={() => setImporting({})}>Import a CSV</button>
          </div></div>
      ) : null}
      {log != null ? <pre className="log">{log}</pre> : null}
    </div>
  );
}

// An account imported from a CSV: no bank access to renew. A newer export goes in with Import again (only
// what's new is added); Remove takes the account and its transactions out, after a second click.
function CsvAccount({ a, onImport }) {
  const { toast, refresh } = useApp();
  const [sure, setSure] = useState(false);
  async function remove() {
    try {
      const { removed } = await api('/api/import/remove', { method: 'POST', body: { uid: a.uid } });
      toast(`${tidy(a.name) || a.bank} removed · ${plural(removed, 'transaction')}`);
      refresh();
    } catch (err) { toast(err.message); }
  }
  return (
    <>
      <div className="account-meta">
        <span>{`Imported from a CSV · ${plural(a.tx_count, 'transaction')}${a.last_synced ? ` · last import ${fmtDate(a.last_synced.slice(0, 10))}` : ''}`}</span>
      </div>
      <div className="account-renew">
        <button className="btn btn-sm" type="button" onClick={onImport}>Import again</button>
        {sure ? (
          <>
            <button className="btn btn-sm btn-ghost is-danger" type="button" onClick={remove}>{`Remove ${plural(a.tx_count, 'transaction')}`}</button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setSure(false)}>Keep</button>
          </>
        ) : <button className="btn btn-sm btn-ghost" type="button" onClick={() => setSure(true)}>Remove</button>}
      </div>
    </>
  );
}

// Connect or renew a bank: pick it, approve access at your bank, and come back. In the desktop app the bank
// opens in an app window and the app notices by itself when you're done; in a browser it opens in a new tab,
// and you can paste the address you end up on if it doesn't come back on its own.
// The bank's login page, from Enable Banking: opened only when it really is an https page (never
// javascript: or another scheme). In the desktop app it opens in the app's own login window: one per link,
// named after it. A shared name would load the bank page into whatever window still had it (the control
// panel, often behind Munto's own), so nothing seemed to open. It's brought to the front, also when opened again.
function openBankPage(url, inApp, state) {
  try { if (new URL(url).protocol !== 'https:') return; } catch { return; }
  window.open(url, inApp ? `munto-bank-${state}` : '_blank')?.focus();
}

// embedded: inside the setup guide, which has its own heading and Back button.
export function LinkPanel({ preselect, linkedBanks, onClose, embedded = false }) {
  const { toast, refresh } = useApp();
  const [banks, setBanks] = useState(null);
  const [appId, setAppId] = useState(null);
  const [bank, setBank] = useState(preselect);
  const [step, setStep] = useState('choose'); // choose | prepare | waiting | syncing
  const [link, setLink] = useState(null); // { state, url }
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState(null);
  const inApp = typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent);
  const poll = useRef(null);

  useEffect(() => {
    api('/api/link/banks').then((r) => { setBanks(r.banks); setAppId(r.app); }).catch((err) => setError(err.message));
    return () => clearInterval(poll.current);
  }, []);
  useEffect(() => { setBank(preselect); }, [preselect]);

  async function done(result) {
    clearInterval(poll.current);
    setStep('syncing');
    const n = result.accounts?.length ?? 0;
    toast(`${result.bank} connected · ${plural(n, 'account')}${result.accounts?.some((a) => a.renewed) ? ' renewed' : ''} · syncing…`);
    const sync = await api('/api/sync', { method: 'POST' }).catch((err) => ({ ok: false, output: err.message }));
    toast(sync.ok ? `${result.bank} is up to date` : 'Connected, but the sync failed: try Sync now');
    refresh();
    onClose();
  }

  async function start() {
    setError(null);
    try {
      const r = await api('/api/link/start', { method: 'POST', body: { bank, browser: !inApp } });
      setLink(r);
      setStep('waiting');
      openBankPage(r.url, inApp, r.state);
      clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const s = await api(`/api/link/status?state=${encodeURIComponent(r.state)}`).catch(() => null);
        if (s?.status === 'done') done({ bank: s.bank, accounts: s.accounts });
        if (s?.status === 'error') { clearInterval(poll.current); failed(s.error); }
      }, 2000);
    } catch (err) { setError(err.message); }
  }

  async function finishPasted() {
    setError(null);
    try { done(await api('/api/link/finish', { method: 'POST', body: { callbackUrl: pasted } })); } catch (err) { failed(err.message); }
  }
  // No accounts shared: in restricted mode the account has to be linked in the control panel first.
  function failed(message) {
    if (/control panel/i.test(message)) { setError(null); setStep('prepare'); setRetry(true); return; }
    setError(message);
    setStep('choose');
  }
  const [retry, setRetry] = useState(false);
  // A bank you haven't connected before: first the control panel checklist. Renewing goes straight on.
  const go = () => (linkedBanks.includes(bank) || step === 'prepare' ? start() : (setError(null), setStep('prepare')));

  return (
    <section className={embedded ? 'link-panel is-embedded' : 'panel link-panel'} aria-labelledby={embedded ? undefined : 'link-h'} aria-label={embedded ? 'Connect a bank' : undefined}>
      {embedded ? null : (
        <div className="panel-head">
          <h2 id="link-h">{preselect ? `Renew ${preselect}` : 'Connect a bank'}</h2>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => { clearInterval(poll.current); onClose(); }}>Cancel</button>
        </div>
      )}
      {step === 'choose' ? (
        <div className="link-step">
          {embedded ? null : <p className="sub">Read-only access, approved at your bank, for up to 180 days.</p>}
          <div className="link-row">
            <label className="field">
              <span>Bank</span>
              <select value={bank} onChange={(e) => setBank(e.target.value)} disabled={!banks}>
                <option value="">{banks ? 'Choose your bank…' : 'Loading the banks…'}</option>
                {(banks ?? []).map((b) => <option key={b.name} value={b.name}>{`${b.name}${b.beta ? ' (beta)' : ''}`}</option>)}
              </select>
            </label>
            <button className="btn btn-ink" type="button" onClick={go} disabled={!bank}><Icon name="bank" />{linkedBanks.includes(bank) || !bank ? `Go to ${bank || 'your bank'}` : 'Next'}</button>
          </div>
        </div>
      ) : step === 'prepare' ? (
        <ControlPanelSteps bank={bank} appId={appId} retry={retry} inApp={inApp} onReady={start} onBack={() => { setRetry(false); setStep('choose'); }} />
      ) : step === 'waiting' ? (
        <div className="link-step">
          <p><b>{`Approve access in ${inApp ? 'the window that opened' : 'the new tab'}.`}</b>{' '}
            {inApp ? 'Munto notices by itself when you’re done.' : 'Come back here afterwards: it notices by itself.'}</p>
          {!inApp ? (
            <div className="link-paste">
              <p className="sub">If it doesn’t: after approving, your browser ends up on <code>{link?.redirectUrl}</code>, maybe with an error page. Copy that whole address and paste it here.</p>
              <div className="link-row">
                <input type="text" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="https://localhost:3443/callback?code=…" aria-label="The address your browser ended up on" />
                <button className="btn" type="button" onClick={finishPasted} disabled={!pasted.trim()}>Connect</button>
              </div>
            </div>
          ) : null}
          <p className="sub"><button className="link-btn" type="button" onClick={() => openBankPage(link.url, inApp, link.state)}>Open the bank page again</button></p>
        </div>
      ) : (
        <p className="link-step"><b>Connected.</b> Bringing in your transactions…</p>
      )}
      {error ? <p className="link-error" role="alert">{error}</p> : null}
    </section>
  );
}

// Enable Banking's free tier (restricted mode) only shares accounts you also linked to your application in its
// control panel. The app can't check or do that for you, so: what to do there, and a button that opens it
// (in the desktop app in an app window, in a browser in a new tab).
const CONTROL_PANEL = 'https://enablebanking.com/cp';
function ControlPanelSteps({ bank, appId, retry, inApp, onReady, onBack }) {
  return (
    <div className="link-step">
      <p><b>{retry ? `${bank} didn’t share any accounts yet.` : `First, once: add ${bank} to your Enable Banking application.`}</b>{' '}
        Munto uses Enable Banking’s free tier for your own accounts. In that tier, an account only comes through after you’ve linked it to your application in Enable Banking’s control panel too.</p>
      <ol className="link-steps">
        <li><b>Open the control panel</b> and sign in to your Enable Banking account.
          {inApp ? ' It opens in a window of Munto. (If Enable Banking emails you a sign-in link, that opens in your browser: carry on there.)' : ' It opens in a new tab.'}</li>
        <li>Go to <b>API applications</b> and open your application{appId ? <> (its ID ends in <code>{appId}</code>)</> : null}.</li>
        <li>Find where you <b>link your own accounts</b> to it (something like <i>Link accounts</i>). Pick <b>Belgium</b> and <b>{bank}</b>, then approve at your bank, the same way you would here.</li>
        <li>Come back here and click <b>{`Go to ${bank}`}</b>.</li>
      </ol>
      <div className="link-row">
        <button className="btn" type="button" onClick={() => window.open(CONTROL_PANEL, inApp ? 'munto-control-panel' : '_blank')?.focus()}>Open the control panel</button>
        <button className="btn btn-ink" type="button" onClick={onReady}><Icon name="bank" />{retry ? `Try ${bank} again` : `I’ve done this · go to ${bank}`}</button>
        {!retry ? <button className="btn btn-ghost" type="button" onClick={onReady}>It’s already linked</button> : null}
        <button className="btn btn-ghost" type="button" onClick={onBack}>Choose another bank</button>
      </div>
    </div>
  );
}
