'use client';
// App-wide client state: config, the unsorted badge, toasts, the chart tooltip, and Claude's
// suggestions (fetched once per visit and shared by Overview and Unsorted).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/lib/errors.js';

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(errorText('offline'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(res.status, data.error));
  return data;
}

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ config, uncategorised, children }) {
  const router = useRouter();
  const [toastState, setToast] = useState(null); // { message, action, id }
  const toastTimer = useRef();
  const [tipState, setTip] = useState(null); // { title, rows, x, y }
  const [suggestions, setSuggestions] = useState({});
  const [aiError, setAiError] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const inflight = useRef(null);
  const [skipped, setSkipped] = useState(() => new Set());

  const toast = useCallback((message, action) => {
    clearTimeout(toastTimer.current);
    setToast({ message, action, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), action ? 8000 : 3500);
  }, []);
  // A toast stays while the pointer or focus is on it, so its Undo can't vanish under your cursor.
  const holdToast = useCallback((held) => {
    clearTimeout(toastTimer.current);
    if (!held) toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // On a touch screen there's no hover to end a tooltip: it stays after the tap that showed it, and a tap
  // anywhere else (or scrolling) closes it.
  const touch = useRef(false);
  useEffect(() => {
    const down = (e) => {
      touch.current = e.pointerType === 'touch';
      if (touch.current && !e.target.closest?.('[data-tip]')) setTip(null);
    };
    const scrolled = () => { if (touch.current) setTip(null); };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('scroll', scrolled, { passive: true });
    return () => { document.removeEventListener('pointerdown', down, true); window.removeEventListener('scroll', scrolled); };
  }, []);
  const tip = useMemo(() => ({
    show(event, title, rows) {
      const rect = event.currentTarget?.getBoundingClientRect?.() ?? event.target.getBoundingClientRect();
      setTip({ title, rows, x: event.clientX || rect.left + rect.width / 2, y: event.clientY || rect.top });
    },
    hide: () => { if (!touch.current) setTip(null); },
  }), []);

  // Fetches suggestions for merchants that don't have one yet (the server caches them too). With
  // "only when I click" chosen under Settings, only from the Ask button (force).
  const loadSuggestions = useCallback(async (groups, { force = false } = {}) => {
    if (!config.aiConfigured || (aiError && !force) || (!config.aiAuto && !force)) return;
    if (!groups.some((g) => !suggestions[g.key])) return;
    if (force) setAiError(null);
    setAiLoading(true);
    inflight.current ??= api('/api/suggest', { method: 'POST', body: {} })
      .then(({ suggestions: fresh }) => { setSuggestions((s) => ({ ...s, ...fresh })); setAiError(null); })
      .catch((err) => setAiError(err.message))
      .finally(() => { inflight.current = null; setAiLoading(false); });
    await inflight.current;
  }, [config.aiConfigured, config.aiAuto, aiError, suggestions]);

  // Saves groups as rules (when the merchant name appears in all of them) in one request.
  const acceptGroups = useCallback((items) => api('/api/review/bulk', {
    method: 'POST',
    body: { items: items.map(({ group, category }) => ({ key: group.key, ids: group.ids, category })) },
  }), []);

  const value = {
    config, uncategorised, toast, tip, refresh: router.refresh, router,
    suggestions, aiError, aiLoading, loadSuggestions, acceptGroups,
    skipped,
    skip: (key) => setSkipped((s) => new Set(s).add(key)),
    unskip: (key) => setSkipped((s) => { const next = new Set(s); next.delete(key); return next; }),
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <Tooltip state={tipState} />
      <Toast state={toastState} onClose={() => setToast(null)} onHold={holdToast} />
    </AppContext.Provider>
  );
}

function Tooltip({ state }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !state) return;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.min(window.innerWidth - width - 8, Math.max(8, state.x + 14))}px`;
    el.style.top = `${Math.max(8, state.y - height - 12)}px`;
  }, [state]);
  return (
    <div className="tooltip" role="tooltip" ref={ref} hidden={!state}>
      {state && (
        <>
          <div className="tt-title">{state.title}</div>
          {state.rows.map((r, i) => (
            <div className="tt-row" key={i}>
              {r.color ? <span className="dot" style={{ '--c': r.color }} /> : null}
              <b>{r.value}</b>
              <span>{r.label}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Toast({ state, onClose, onHold }) {
  // The last message stays for the short fade-out after the toast closes.
  const [shown, setShown] = useState(state);
  useEffect(() => {
    if (state) { setShown(state); return undefined; }
    const t = setTimeout(() => setShown(null), 150);
    return () => clearTimeout(t);
  }, [state]);
  const view = state ?? shown;
  return (
    <div className={`toast${!state && shown ? ' is-leaving' : ''}`} role="status" aria-live="polite" hidden={!view}
      onPointerEnter={() => onHold(true)} onPointerLeave={() => onHold(false)}
      onFocus={() => onHold(true)} onBlur={() => onHold(false)}>
      {view && (
        <>
          <span>{view.message}</span>
          {view.action && (
            <button className="btn btn-sm" type="button" disabled={!state} onClick={async () => { onClose(); await view.action.run(); }}>
              {view.action.label}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Pointer and keyboard handlers that show a tooltip built by fn(event).
export const tipHandlers = (tip, fn) => ({
  'data-tip': '', onPointerDown: (e) => fn(e),
  onPointerMove: (e) => fn(e), onPointerLeave: tip.hide, onFocus: (e) => fn(e), onBlur: tip.hide,
});
