'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { cleanDesc, fmtDate, fmtIban, fmtMoney, fmtShort, plural, signed, tidy } from '@/lib/format.js';
import { api, useApp } from './app.jsx';
import { CategoryChip, Icon, Jar, Money, useKey } from './ui.jsx';

const PAGE = 20;

export function Review({ groups }) {
  const { config, suggestions, aiError, aiLoading, loadSuggestions, acceptGroups, toast, refresh, skipped } = useApp();
  // The pot currently shown on each card, so "Accept all" respects changes made by hand.
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  // Merchants sorted on this page: hidden straight away, before the refreshed list arrives.
  const [done, setDone] = useState(() => new Set());
  const list = useRef(null);
  useEffect(() => { loadSuggestions(groups); }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = groups.filter((g) => !skipped.has(g.key) && !done.has(g.key));
  const setDoneFor = (key, on) => setDone((d) => { const next = new Set(d); if (on) next.add(key); else next.delete(key); return next; });

  // j and k move between the cards' pot pickers, so a sit-down sort needs no mouse.
  const step = (by) => {
    const pickers = [...(list.current?.querySelectorAll('.sort-pick select') ?? [])];
    if (!pickers.length) return false;
    const at = pickers.findIndex((p) => p.closest('.sort-card')?.contains(document.activeElement));
    pickers[at < 0 ? 0 : Math.max(0, Math.min(pickers.length - 1, at + by))].focus();
    return true;
  };
  useKey('j', () => step(1));
  useKey('k', () => step(-1));

  // A card has left: if focus was in it, it moves on to the pot picker of the card that took its place.
  function gone(index, hadFocus) {
    if (!hadFocus) return;
    requestAnimationFrame(() => {
      const pickers = list.current?.querySelectorAll('.sort-pick select') ?? [];
      (pickers[index] ?? pickers[pickers.length - 1])?.focus();
    });
  }
  const remaining = groups.reduce((n, g) => n + g.count, 0);
  const categoryOf = (g) => picked[g.key] ?? suggestions[g.key]?.category ?? '';

  const head = (
    <div className="page-head">
      <div>
        <h1>Unsorted</h1>
        <p className="sub" style={{ marginTop: 4 }}>
          {groups.length ? `${plural(remaining, 'transaction')} from ${plural(groups.length, 'merchant')}` : 'Nothing left to sort'}
        </p>
        {groups.length ? <p className="sub keys-hint"><kbd>j</kbd> <kbd>k</kbd> move between merchants, <kbd>Enter</kbd> saves the pot you picked</p> : null}
      </div>
    </div>
  );

  if (groups.length === 0) {
    return (
      <div>
        {head}
        <div className="empty"><Jar fill={1} className="jar-empty" /><strong>Every euro is in a pot</strong>New transactions are sorted by your rules when you sync. Anything new ends up here.</div>
      </div>
    );
  }

  const suggested = visible.filter((g) => suggestions[g.key]);
  async function acceptAll() {
    setBusy(true);
    const items = suggested.map((g) => ({ group: g, category: categoryOf(g) })).filter((i) => i.category && i.category !== '__new');
    try {
      const { rules } = await acceptGroups(items);
      toast(`Sorted ${plural(items.length, 'merchant')} · ${plural(rules, 'rule')} saved for next time`);
      refresh();
    } catch (err) { toast(err.message); }
    setBusy(false);
  }

  let aiBar;
  if (!config.aiConfigured) {
    aiBar = <><span className="ai-mark is-quiet"><Icon name="sparkle" /></span><div className="ai-text"><strong>Let an AI pre-sort these</strong><MissingAiHelp /></div></>;
  } else if (aiLoading) {
    aiBar = (
      <><span className="ai-mark"><Icon name="sparkle" /></span>
        <div className="ai-text"><strong>{`${config.aiName ?? 'AI'} is suggesting pots for ${plural(groups.length, 'merchant')}…`}</strong>
          <p>{`Only the names, ${config.aiSendsAmounts ? 'amounts ' : 'in or out '}and descriptions of these unsorted transactions are sent, to ${config.aiSentTo ?? 'the AI you chose'}.`}</p></div></>
    );
  } else if (!config.aiAuto && !suggested.length) {
    aiBar = (
      <><span className="ai-mark"><Icon name="sparkle" /></span>
        <div className="ai-text"><strong>{`Ask ${config.aiName ?? 'the AI'} to pre-sort ${plural(groups.length, 'merchant')}?`}</strong>
          <p>{`It sees their names, ${config.aiSendsAmounts ? 'amounts ' : 'whether money went in or out '}and descriptions. Sent to ${config.aiSentTo ?? 'the AI you chose'}.`}</p></div>
        <button className="btn btn-sm" type="button" onClick={() => loadSuggestions(groups, { force: true })}><Icon name="sparkle" />Ask</button></>
    );
  } else if (aiError) {
    aiBar = (
      <><span className="ai-mark"><Icon name="sparkle" /></span>
        <div className="ai-text"><strong>AI suggestions aren’t available right now</strong><p>{aiError}</p></div>
        <button className="btn btn-sm" type="button" onClick={() => loadSuggestions(groups, { force: true })}>Try again</button></>
    );
  } else {
    aiBar = (
      <><span className="ai-mark"><Icon name="sparkle" /></span>
        <div className="ai-text">
          <strong>{`${config.aiName ?? 'AI'} suggested a pot for ${suggested.length} of ${visible.length} merchants`}</strong>
          <p>Check the ones that look off, then accept. Each one becomes a rule, so next month sorts itself.</p>
        </div>
        <button className={`btn btn-need${busy ? ' is-busy' : ''}`} type="button" disabled={!suggested.length || busy} onClick={acceptAll}>
          <Icon name="check" />{suggested.length ? `Accept all ${suggested.length}` : 'No suggestions'}
        </button></>
    );
  }

  return (
    <div>
      {head}
      <div className="ai-bar" role="region" aria-label="AI suggestions">{aiBar}</div>
      <div className="sort-list" ref={list}>
        {visible.slice(0, limit).map((g, i) => (
          <SortCard key={g.key} group={g} category={categoryOf(g)}
            onPick={(c) => setPicked((p) => ({ ...p, [g.key]: c }))}
            onGone={(hadFocus) => gone(i, hadFocus)} setDone={(on) => setDoneFor(g.key, on)} />
        ))}
      </div>
      {visible.length > limit || skipped.size ? (
        <p className="sub sort-more">
          {visible.length > limit ? (
            <button className="btn btn-sm" type="button" onClick={() => setLimit((n) => n + PAGE)}>
              {`Show ${Math.min(PAGE, visible.length - limit)} more`}
            </button>
          ) : null}
          {skipped.size ? `${skipped.size} skipped for now` : null}
        </p>
      ) : null}
    </div>
  );
}

const MissingAiHelp = () => (
  <p>
    An AI can suggest a pot for every merchant; you approve. Choose one under <Link href="/settings">Settings</Link>:
    Claude Code on your Claude subscription, the Claude API, OpenAI, Gemini, or a model on this computer through Ollama.
  </p>
);

// "21 Sep", with the year only when it isn't this year.
const shortDate = (iso) => (iso.slice(0, 4) === String(new Date().getFullYear()) ? fmtShort(iso) : fmtDate(iso));

// One merchant to sort. Picking a pot saves it (the toast can undo it); a pot the AI suggested is
// taken with Accept. Only a transfer to what may be your own account asks first, with Save.
function SortCard({ group, category, onPick, onGone, setDone }) {
  const { config, suggestions, toast, refresh, skip, unskip } = useApp();
  const { transferCategory } = config;
  const suggestion = suggestions[group.key];
  const incoming = group.totalCents > 0;
  const [always, setAlways] = useState(true);
  const [match, setMatch] = useState(group.key.toLowerCase());
  const [editing, setEditing] = useState(false);
  const [own, setOwn] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const card = useRef(null);
  const name = tidy(group.key);

  const asksFirst = (c) => c === transferCategory && group.ibans.length > 0;
  const isTransfer = asksFirst(category);
  const isOwn = isTransfer && own;

  // Fades the card out and closes its gap, then hands it to `then` (hide it, or skip it).
  function leave(then) {
    const hadFocus = card.current?.contains(document.activeElement);
    setLeaving(true);
    setTimeout(() => { then(); onGone(hadFocus); }, 320);
  }

  async function save(pot = category) {
    if (!pot) { setError('Choose a pot first.'); return; }
    const mode = asksFirst(pot) && own ? 'own' : always ? 'rule' : 'manual';
    setSaving(true);
    try {
      const { mode: done, undo } = await api('/api/review', { method: 'POST', body: { ids: group.ids, category: pot, mode, match, orManual: true } });
      leave(() => { setDone(true); refresh(); });
      toast(done === 'rule' ? `“${match}” goes in ${pot} from now on` : done === 'own' ? `${name} saved as your own account` : `${name} put in ${pot}`, {
        label: 'Undo',
        run: async () => {
          try {
            await api('/api/review/undo', { method: 'POST', body: undo });
            setDone(false);
            refresh();
          } catch (err) { toast(err.message); }
        },
      });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // A click or tap on a pot saves it at once. From the keyboard a <select> changes as you arrow through it
  // (on Windows and Linux), so there the pick waits for Enter or Save.
  const keyed = useRef(false);
  function pick(pot) {
    setError(null);
    onPick(pot);
    if (pot && !asksFirst(pot) && !keyed.current) save(pot);
  }
  const fromPicker = {
    onPointerDownCapture: () => { keyed.current = false; },
    onKeyDownCapture: (e) => {
      if (e.target.tagName !== 'SELECT') return;
      if (e.key === 'Enter' && category && !asksFirst(category)) { e.preventDefault(); save(); return; }
      if (e.key !== 'Tab') keyed.current = true;
    },
  };

  function skipIt() {
    leave(() => skip(group.key));
    toast(`Skipped ${name}`, { label: 'Undo', run: () => unskip(group.key) });
  }

  const showSave = isTransfer || (category && (suggestion || keyed.current));
  return (
    <div className={`sort-slot${leaving ? ' is-leaving' : ''}`}>
      <article className="sort-card" aria-label={name} ref={card} inert={leaving || undefined}>
        <div>
          <div className="sort-who">{name}</div>
          <div className="sort-meta">
            {plural(group.count, 'transaction')}{' · '}
            <span className={incoming ? 'is-in' : ''}>{incoming ? `${signed(group.totalCents)} came in` : `${fmtMoney(-group.totalCents)} out`}</span>
          </div>
          <ul className="sort-examples">
            {group.examples.map((e, i) => (
              <li key={i}>
                <span className="date">{shortDate(e.date)}</span>
                <Money cents={e.cents} sign className={e.cents > 0 ? 'is-in' : ''} />
                <span className="desc" title={e.description ?? ''}>{cleanDesc(e.description)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="sort-side">
          <div className="sort-pick" {...fromPicker}>
            <CategoryChip label={`Pot for ${name}`} includeNone={false} wide placeholder="Choose pot…" value={category} onChange={pick} />
            {showSave ? (
              <button className={`btn btn-ink${saving ? ' is-busy' : ''}`} type="button" disabled={saving} onClick={() => save()}>
                <Icon name="check" />{isTransfer || !suggestion || category !== suggestion.category ? 'Save' : 'Accept'}
              </button>
            ) : null}
            <button className="btn btn-ghost" type="button" onClick={skipIt}>Skip</button>
          </div>
          {suggestion ? (
            <div className="sort-reason"><span className="ai-mark"><Icon name="sparkle" />Suggested</span>{' · '}{suggestion.reason || suggestion.category}</div>
          ) : null}
          {incoming ? <div className="hint">Paid back? Pick the pot it was for.</div> : null}
          {isTransfer ? (
            <label className="check sort-own">
              <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
              {group.ibans.length === 1 ? `${fmtIban(group.ibans[0])} is my own account` : `These ${group.ibans.length} IBANs are my own accounts`}
            </label>
          ) : null}
          {isOwn ? null : editing ? (
            <div className="sort-options">
              <label className="check"><input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />Always sort</label>
              <input type="text" className="match" value={match} disabled={!always} aria-label="Text the rule matches" onChange={(e) => setMatch(e.target.value)} />
            </div>
          ) : (
            <div className="sort-rule">
              {always ? <>Next time, <q>{match}</q> sorts itself</> : 'Only these ones'}
              <span className="nowrap">{' · '}<button className="link-btn" type="button" onClick={() => setEditing(true)}>Change</button></span>
            </div>
          )}
          {error ? <div className="error-text" role="alert">{error}</div> : null}
        </div>
      </article>
    </div>
  );
}
