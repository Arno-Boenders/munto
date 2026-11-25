'use client';
// Small building blocks shared by every page.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ICONS, look } from '@/lib/look.js';
import { fmtMoney, fmtMonth, plural, signed } from '@/lib/format.js';
import { api, useApp } from './app.jsx';

export function Icon({ name }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.other} />
    </svg>
  );
}

// Something is working in the background. The words next to it say what.
export const Spinner = () => <span className="spinner" aria-hidden="true" />;

// An amount, with even-width digits so columns line up.
export function Money({ cents, sign = false, className = '' }) {
  return <span className={`money ${className}`.trim()}>{sign ? signed(cents) : fmtMoney(cents)}</span>;
}

export function Swatch({ category, size = '' }) {
  const l = look(category);
  return <span className={`swatch ${size}`.trim()} style={{ '--c': l.color }}><Icon name={l.icon} /></span>;
}

export const Dot = ({ category, color }) => <span className="dot" style={{ '--c': color ?? look(category).color }} />;

// The jar: it fills as you spend, and its shoulder is the budget (or the usual, without one). A dashed line
// across it marks the usual, labelled (`usualText`) while the pot is hovered. Over budget, the lid no longer closes and coins pile up in the neck.
// The same jar shows a pot's fill everywhere: big on a pot card, small (`jar-mini`) in lists.
const JAR = 'M27 18h26v6c0 3 13 6 15 14v50a10 10 0 0 1-10 10H22a10 10 0 0 1-10-10V38c2-8 15-11 15-14z';
export function Jar({ fill, usual = null, usualText = null, over = false, grown = true, className = '' }) {
  const id = useId();
  const top = 34, h = 62;
  // Over budget only shows once the jar has filled, so the coins rise first and then the lid pops.
  const popped = over && grown;
  const level = !grown ? 0 : over ? 1 : Math.max(0, Math.min(1, fill));
  return (
    <svg className={`jar${popped ? ' is-over' : ''} ${className}`.trim()} viewBox="0 0 80 100" aria-hidden="true">
      <defs>
        <clipPath id={`${id}j`}><path d={JAR} /></clipPath>
        <pattern id={`${id}s`} width="8" height="6" patternUnits="userSpaceOnUse">
          <rect className="jar-coin" width="8" height="6" /><rect className="jar-stack" y="5" width="8" height="1" />
        </pattern>
      </defs>
      <path className="jar-glass" d={JAR} />
      {/* The coins: a full column moved down by how empty the jar is, clipped to the jar (the clip sits on the
          group so it doesn't move along). Moving it is a transform, which the browser doesn't repaint. */}
      <g clipPath={`url(#${id}j)`}>
        <rect className="jar-level" x="0" y="18" width="80" height="82" fill={`url(#${id}s)`}
          style={{ '--y': `${popped ? 0 : Math.min(82, top + h * (1 - level) - 18)}px` }} />
      </g>
      <path className="jar-edge" d={JAR} />
      {usual != null && !popped && usual > 0 && usual < 1 ? (
        <g className="jar-usual">
          <path clipPath={`url(#${id}j)`} d={`M0 ${top + h * (1 - usual)}H80`} />
          {usualText ? <text x="40" y={top + h * (1 - usual) - 5}>{usualText}</text> : null}
        </g>
      ) : null}
      {/* Always there, so going over can animate: CSS pops the lid and lets the coins spill (.is-over). */}
      <g className="jar-spill"><ellipse cx="33" cy="24" rx="7" ry="2.6" /><ellipse cx="46" cy="21" rx="7" ry="2.6" /><ellipse cx="40" cy="16.5" rx="7" ry="2.6" /></g>
      <rect className="jar-lid" x="20" y="6" width="40" height="10" rx="2.5" />
    </svg>
  );
}

// A segmented control: options is [[value, label], ...].
export function Segmented({ options, value, onChange, label, className = '' }) {
  return (
    <div className={`segmented ${className}`.trim()} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={String(v === value)} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

// A native select dressed as a coloured category chip. Controlled: the parent owns `value`.
// "+ New category…" asks for a name, creates it, then selects it.
export function CategoryChip({ value, onChange, label, includeNone = true, wide = false, placeholder }) {
  const { config, refresh, toast } = useApp();
  const [extra, setExtra] = useState([]);
  const [adding, setAdding] = useState(false); // "+ New pot…" turns the chip into a field for its name
  const categories = [...config.categories, ...extra.filter((c) => !config.categories.includes(c))];
  const color = look(value || null).color;

  function change(e) {
    if (e.target.value === '__new') setAdding(true);
    else onChange(e.target.value);
  }
  async function add(name) {
    name = name.trim();
    if (!name) { setAdding(false); return; }
    try {
      await api('/api/categories', { method: 'POST', body: { name } });
    } catch (err) { toast(err.message); return; }
    setExtra((x) => [...x, name]);
    setAdding(false);
    refresh();
    onChange(name);
  }

  if (adding) {
    return (
      <form className="chip-new" onSubmit={(e) => { e.preventDefault(); add(e.currentTarget.elements.name.value); }}>
        <input name="name" type="text" autoFocus placeholder="Name of the new pot" aria-label={`New pot (${label})`}
          onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} onBlur={(e) => { if (!e.target.value.trim()) setAdding(false); }} />
        <button className="btn btn-sm btn-ink" type="submit">Add</button>
      </form>
    );
  }

  return (
    <span className={`chip-select${wide ? ' is-wide' : ''}${value ? '' : ' is-empty'}`} style={{ '--c': color }}>
      <span className="dot" style={{ '--c': color }} />
      <select aria-label={label} value={value ?? ''} onChange={change}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {includeNone ? <option value="">Unsorted</option> : null}
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value="__new">+ New pot…</option>
      </select>
    </span>
  );
}

// ‹ September 2026 ›  (months are newest first)
export function MonthStepper({ months, month, onPick, allowAll = false }) {
  const i = months.indexOf(month);
  const older = month ? months[i + 1] : null;
  const newer = month ? months[i - 1] : null;
  // ← and → step through the months from anywhere on the page.
  useKey('ArrowLeft', () => (older ? onPick(older) : false));
  useKey('ArrowRight', () => (newer ? onPick(newer) : false));
  return (
    <div className="stepper">
      <button className="btn btn-ghost btn-icon" type="button" aria-label="Previous month" title="Previous month (←)" aria-keyshortcuts="ArrowLeft" disabled={!older} onClick={() => onPick(older)}>
        <Icon name="left" />
      </button>
      <span className="stepper-label">
        {month ? fmtMonth(month) : 'All months'}
        <select aria-label="Month" value={month ?? ''} onChange={(e) => onPick(e.target.value)}>
          {allowAll ? <option value="">All months</option> : null}
          {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
        </select>
      </span>
      <button className="btn btn-ghost btn-icon" type="button" aria-label="Next month" title="Next month (→)" aria-keyshortcuts="ArrowRight" disabled={!newer} onClick={() => onPick(newer)}>
        <Icon name="right" />
      </button>
    </div>
  );
}

// Runs the same thing as `npm run sync`: pulls new transactions from the bank and sorts them by your rules.
// onOutput receives the sync log; without it, errors point to the Accounts page.
export function SyncButton({ small = false, onOutput }) {
  const { toast, refresh, router } = useApp();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const result = await api('/api/sync', { method: 'POST', body: {} });
      onOutput?.(result.output || 'Done.');
      const unsorted = Number(result.output?.match(/(\d+) transactions need a category/)?.[1] ?? 0);
      if (!result.ok) toast('Sync had errors', onOutput ? undefined : { label: 'See log', run: () => router.push('/accounts') });
      else if (unsorted) toast(`Synced · ${plural(unsorted, 'transaction')} to sort`, { label: 'Sort them', run: () => router.push('/review') });
      else toast('Synced · everything is sorted');
      refresh();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className={`btn btn-ink${small ? ' btn-sm' : ''}${busy ? ' is-busy' : ''}`} type="button" disabled={busy}
      title="Fetch new transactions from your bank" onClick={run}>
      <Icon name="sync" />{busy ? 'Syncing…' : 'Sync now'}
    </button>
  );
}

// ---------- theme ----------

export const THEMES = ['auto', 'light', 'dark'];
export const THEME_NAMES = { auto: 'Match system', light: 'Light', dark: 'Dark' };

// The theme lives on <html data-theme> (set before first paint by the script in the layout).
export function useTheme() {
  const [theme, setThemeState] = useState('auto');
  useEffect(() => {
    const read = () => setThemeState(document.documentElement.dataset.theme ?? 'auto');
    read();
    window.addEventListener('themechange', read);
    return () => window.removeEventListener('themechange', read);
  }, []);
  const setTheme = (t) => {
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try { t === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t); } catch { /* optional */ }
    window.__themeColor?.();
    window.dispatchEvent(new Event('themechange'));
  };
  return [theme, setTheme];
}

export function ThemeSegmented() {
  const [theme, setTheme] = useTheme();
  return <Segmented label="Theme" options={THEMES.map((t) => [t, THEME_NAMES[t]])} value={theme} onChange={setTheme} />;
}

// ---------- hooks ----------

// A one-key shortcut for the page ("/", "ArrowLeft", "j"). It stays out of the way while you type or pick
// in a field, and ignores keys held with Ctrl, Cmd or Alt (those belong to the browser).
export const typing = (el) => !!el?.closest?.('input, select, textarea, [contenteditable="true"], [role="slider"]');
export function useKey(key, fn, enabled = true) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    const keys = [].concat(key);
    const down = (e) => {
      if (!keys.includes(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      if (latest.current(e) !== false) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [String(key), enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

// The element's width, kept up to date; charts draw at this width.
export function useWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || fallback);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width];
}

// False on first paint, true right after, so gauges can grow in.
// The jars fill from empty the first time they're shown in a visit; after that they're simply there
// (Overview is visited all the time), and only a real change, like stepping a month, moves them.
export function useGrown() {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem('jars-grown') === '1'; } catch { /* optional */ }
    const root = document.documentElement;
    if (seen) root.dataset.jarsStill = '';
    // Two frames so the empty jars are painted first (or, when seen, so the jump happens without a transition).
    const frames = [];
    const after = (n, fn) => { frames.push(requestAnimationFrame(() => (n > 1 ? after(n - 1, fn) : fn()))); };
    after(2, () => {
      setGrown(true);
      try { sessionStorage.setItem('jars-grown', '1'); } catch { /* optional */ }
      if (seen) after(2, () => delete root.dataset.jarsStill);
    });
    return () => { frames.forEach(cancelAnimationFrame); delete root.dataset.jarsStill; };
  }, []);
  return grown;
}

// A remembered per-browser preference (e.g. the chart you last looked at).
export function usePref(key, fallback) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    try { const v = localStorage.getItem(key); if (v != null) setValue(v); } catch { /* optional */ }
  }, [key]);
  const set = (v) => { setValue(v); try { localStorage.setItem(key, v); } catch { /* optional */ } };
  return [value, set];
}

// The bar that appears at the bottom while a page has unsaved changes: one Save for everything.
export function SaveBar({ label, onSave, onUndo, busy = false, blocked = null }) {
  return (
    <div className="savebar" role="region" aria-label="Unsaved changes">
      <span>{label}</span>
      <button className="btn btn-ghost" type="button" disabled={busy} onClick={onUndo}>Undo</button>
      <button className={`btn btn-ink${busy ? ' is-busy' : ''}`} type="button" disabled={busy || !!blocked} onClick={onSave}>
        <Icon name="check" />{blocked ?? (busy ? 'Saving…' : 'Save all')}
      </button>
    </div>
  );
}
