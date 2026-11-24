'use client';
// The setup guide: a first start walks through Enable Banking, your bank, payday and AI one step at a time,
// in a page of its own without the menu. The same steps stay on the Settings page for later changes.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fmtMoney, plural } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { Icon } from './ui.jsx';
import { AiStep, EnableBankingStep } from './setup.jsx';
import { LinkPanel } from './accounts.jsx';
import { Expected, MonthStart, useIncomeDraft } from './income.jsx';

// [key, label in the progress line, heading]
const STEPS = [
  ['welcome', null, 'Welcome to Munto'],
  ['eb', 'Enable Banking', 'Your Enable Banking application'],
  ['bank', 'Your bank', 'Connect your bank'],
  ['income', 'Payday', 'Payday and income'],
  ['ai', 'AI', 'Sorting with AI'],
  ['done', null, 'You’re set up'],
];

export function Welcome({ state: initialState, income: initialIncome }) {
  const { toast, router } = useApp();
  const [state, setState] = useState(initialState);
  const [income, setIncome] = useState(initialIncome);
  const [step, setStep] = useState('welcome');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const at = STEPS.findIndex(([key]) => key === step);
  const incomeDraft = useIncomeDraft(income);

  // The new step's heading takes focus, so the keyboard and a screen reader start there.
  const heading = useRef(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
    // A sync may have found your salary since the page loaded: the income step shows what's there now.
    if (step === 'income') api('/api/income').then(setIncome).catch(() => {});
  }, [step]);

  const go = (key) => { setError(null); setBusy(null); setStep(key); };
  const next = () => go(STEPS[at + 1][0]);
  const back = () => go(STEPS[at - 1][0]);
  const reload = () => api('/api/setup').then((s) => { setState(s); return s; });
  // Where an earlier, unfinished setup stopped.
  const resume = !state.enableBanking.configured ? 'eb' : !state.banks.length ? 'bank' : 'income';
  const started = state.enableBanking.configured || state.banks.length > 0;

  // Finished or skipped: the guide doesn't open by itself again.
  async function finish(href) {
    setBusy('finish');
    try {
      await api('/api/setup/welcome', { method: 'POST', body: {} });
      router.push(href);
    } catch (err) { setError(err.message); setBusy(null); }
  }
  async function trySample() {
    setBusy('sample'); setError(null);
    try {
      await api('/api/setup/sample', { method: 'POST', body: {} });
      toast('Sample data added · have a look around');
      router.push('/');
    } catch (err) { setError(err.message); setBusy(null); }
  }
  async function saveIncome() {
    const { changes, problem } = incomeDraft;
    if (problem) return setError(problem);
    if (Object.keys(changes).length) {
      setBusy('income');
      try {
        await api('/api/income/settings', { method: 'POST', body: changes });
        setIncome(await api('/api/income'));
      } catch (err) { setError(err.message); setBusy(null); return; }
    }
    next();
  }

  const done = { eb: state.enableBanking.configured, bank: state.banks.length > 0, ai: state.aiChosen };
  const title = step === 'done' && !done.bank ? 'The rest can wait' : STEPS[at][2];

  return (
    <div className="welcome">
      <header className="welcome-head">
        <span className="welcome-brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle className="coin" cx="16" cy="16" r="14.2" /><circle className="rim" cx="16" cy="16" r="10.2" /><path d="M19.6 11.8a5.2 5.2 0 1 0 0 8.4M10.8 14.6h6.4M10.8 17.4h6.4" /></svg>
          Munto
        </span>
        {STEPS[at][1] ? (
          <ol className="welcome-progress" aria-label="Setup steps">
            {STEPS.filter(([, label]) => label).map(([key, label], i) => (
              <li key={key} aria-current={key === step ? 'step' : undefined} className={done[key] ? 'is-done' : ''}>
                {done[key] && key !== step ? <Icon name="check" /> : <span className="welcome-num" aria-hidden="true">{i + 1}</span>}
                <span className="welcome-label">{label}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </header>

      <section className="welcome-step" aria-labelledby="welcome-h">
        <h1 id="welcome-h" ref={heading} tabIndex={-1}>{title}</h1>

        {step === 'welcome' ? (
          <>
            <p className="welcome-lead">Munto sorts your bank’s transactions into pots and shows what’s left until payday.</p>
            <ul className="welcome-facts">
              <li><Icon name="jar" /><span><b>Everything stays on this computer.</b> No account, no server.</span></li>
              <li><Icon name="bank" /><span>It reads your bank through Enable Banking: free for your own accounts, and about 15 minutes to set up.</span></li>
              <li><Icon name="sparkle" /><span>Sorting with AI is optional, and you choose which AI.</span></li>
            </ul>
            <div className="welcome-actions">
              <button className="btn btn-ink" type="button" onClick={() => go(resume)}>{started ? 'Carry on with setup' : 'Set up Munto'}<Icon name="right" /></button>
              {!state.banks.length ? (
                <button className="btn" type="button" onClick={trySample} disabled={!!busy}>{busy === 'sample' ? 'One moment…' : 'Try with sample data first'}</button>
              ) : null}
              <button className="btn btn-ghost" type="button" onClick={() => finish('/')} disabled={!!busy}>Skip, set up later</button>
            </div>
          </>
        ) : null}

        {step === 'eb' ? (
          <div className="welcome-body">
            <EnableBankingStep state={state} onSaved={(s) => { setState(s); toast('Enable Banking is set up'); next(); }} />
          </div>
        ) : null}

        {step === 'bank' ? (
          <div className="welcome-body">
            {!done.eb ? (
              <>
                <p>Set up your Enable Banking application first: Munto connects to your bank through it.</p>
                <p>{'No Enable Banking? '}<Link className="link-btn" href="/accounts?import=1">Import your bank’s CSV export</Link>{' instead, and carry on here later from Settings.'}</p>
              </>
            ) : done.bank && busy !== 'another' ? (
              <>
                <p className="setup-note"><Icon name="check" />{`${state.banks.join(', ')} connected · ${plural(state.transactions, 'transaction')}`}</p>
                <div><button className="btn btn-sm" type="button" onClick={() => setBusy('another')}><Icon name="bank" />Connect another bank</button></div>
              </>
            ) : (
              <>
                <p>Read-only access, approved at your bank, for up to 180 days. Munto brings in your transactions right after.</p>
                <LinkPanel embedded preselect="" linkedBanks={state.banks}
                  onClose={async () => { const s = await reload(); setBusy(null); if (s.banks.length) next(); }} />
              </>
            )}
          </div>
        ) : null}

        {step === 'income' ? (
          <div className="welcome-body welcome-income">
            <p>Your month runs from payday to payday, so <i>Left</i> is what you have until the next salary.</p>
            <MonthStart data={income} draft={incomeDraft.draft} change={incomeDraft.change} />
            <Expected data={income} draft={incomeDraft.draft} change={incomeDraft.change} />
            <p className="sub">Which payments count as your salary: on the Income page, once your transactions are in.</p>
          </div>
        ) : null}

        {step === 'ai' ? (
          <div className="welcome-body">
            <AiStep onSaved={() => reload().then(next)} />
          </div>
        ) : null}

        {step === 'done' ? (
          <>
            <ul className="welcome-summary">
              <Summary ok={done.eb} label="Enable Banking" value={done.eb ? 'Set up' : 'Not yet: under Settings'} />
              <Summary ok={done.bank} label="Bank" value={done.bank ? `${state.banks.join(', ')} · ${plural(state.transactions, 'transaction')}` : 'Not yet: under Accounts'} />
              <Summary ok label="Month" value={income.paydayFromDay === 0 ? 'Starts on the 1st' : `Starts on payday, on or after day ${income.paydayFromDay}`} />
              {income.expectedMonthlyCents ? <Summary ok label="Expected income" value={`${fmtMoney(income.expectedMonthlyCents)} a month`} /> : null}
              <Summary ok={state.ai} label="AI" value={state.ai ? state.aiName : 'Off: rules and sorting by hand'} />
            </ul>
            <div className="welcome-actions">
              {state.uncategorised > 0 ? (
                <>
                  <button className="btn btn-ink" type="button" onClick={() => finish('/review')} disabled={!!busy}>{`Sort ${plural(state.uncategorised, 'transaction')}`}<Icon name="right" /></button>
                  <button className="btn" type="button" onClick={() => finish('/')} disabled={!!busy}>See the Overview</button>
                </>
              ) : (
                <button className="btn btn-ink" type="button" onClick={() => finish('/')} disabled={!!busy}>See the Overview<Icon name="right" /></button>
              )}
            </div>
          </>
        ) : null}

        {error ? <p className="link-error" role="alert">{error}</p> : null}
      </section>

      {step !== 'welcome' && step !== 'done' ? (
        <footer className="welcome-foot">
          <button className="btn btn-ghost" type="button" onClick={back} disabled={busy === 'income'}><Icon name="left" />Back</button>
          <span className="welcome-count">{`Step ${at} of ${STEPS.length - 2}`}</span>
          {step === 'income' ? (
            <button className="btn btn-ink" type="button" onClick={saveIncome} disabled={busy === 'income'}>{busy === 'income' ? 'Saving…' : 'Next'}<Icon name="right" /></button>
          ) : done[step] ? (
            <button className="btn btn-ink" type="button" onClick={next}>Next<Icon name="right" /></button>
          ) : (
            <button className="btn btn-ghost" type="button" onClick={next}>{step === 'ai' ? 'Skip: no AI for now' : 'Skip for now'}</button>
          )}
        </footer>
      ) : null}
    </div>
  );
}

function Summary({ ok, label, value }) {
  return (
    <li className={ok ? '' : 'is-todo'}>
      {ok ? <Icon name="check" /> : <span className="welcome-dash" aria-hidden="true">–</span>}
      <b>{label}</b>
      <span>{value}</span>
    </li>
  );
}
