'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './app.jsx';
import { Icon, THEMES, THEME_NAMES, useTheme } from './ui.jsx';

// [href, key, icon, label, onPhone]: on a phone, the last ones move under "More". Trends, Where to cut,
// Savings and Rules only show when they're switched on under Settings.
const LINKS = [
  ['/', 'overview', 'jar', 'Overview', true],
  ['/transactions', 'transactions', 'list', 'Transactions', true],
  ['/review', 'review', 'inbox', 'Unsorted', true],
  ['/budget', 'budget', 'budget', 'Budget', true],
  ['/trends', 'trends', 'chart', 'Trends', false],
  ['/cut', 'cut', 'scissors', 'Where to cut', false],
  ['/subscriptions', 'subscriptions', 'subscriptions', 'Subscriptions', false],
  ['/income', 'income', 'income', 'Income', false],
  ['/savings', 'savings', 'growth', 'Savings', false],
  ['/accounts', 'accounts', 'bank', 'Accounts', false],
  ['/rules', 'rules', 'sliders', 'Rules', false],
  ['/settings', 'settings', 'gear', 'Settings', false],
];

export function Nav() {
  const pathname = usePathname();
  const { config, uncategorised } = useApp();
  // The Unsorted badge ticks once when its count goes down: the sort you just did landed.
  const before = useRef(uncategorised);
  const [tick, setTick] = useState(false);
  useEffect(() => {
    const fewer = uncategorised < before.current;
    before.current = uncategorised;
    if (!fewer) return undefined;
    setTick(true);
    const t = setTimeout(() => setTick(false), 260);
    return () => clearTimeout(t);
  }, [uncategorised]);
  const links = LINKS.filter(([, key]) => config.features[key] !== false);
  const [theme, setTheme] = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  // Close "More" on a tap outside it, or Escape.
  useEffect(() => {
    if (!moreOpen) return undefined;
    const outside = (e) => { if (!e.target.closest('.nav-sheet, .nav-more')) setMoreOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc); };
  }, [moreOpen]);
  const inMore = links.some(([href, , , , onPhone]) => !onPhone && href === pathname);
  if (pathname === '/welcome') return null; // the setup guide is a page of its own

  const link = ([href, key, icon, label, onPhone]) => (
    <Link key={key} href={href} data-nav={key} data-more={onPhone ? undefined : ''} aria-current={pathname === href ? 'page' : undefined}>
      <Icon name={icon} />
      <span>{label}</span>
      {key === 'review' && uncategorised > 0 ? (
        <> <b className={`badge${tick ? ' is-tick' : ''}`} title={`${uncategorised} unsorted transactions, all months`}>{uncategorised > 999 ? '999+' : uncategorised}</b></>
      ) : null}
    </Link>
  );

  return (
    <nav className={`nav${moreOpen ? ' is-more-open' : ''}`} aria-label="Main">
      <Link className="brand" href="/" aria-label="Munto, overview">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle className="coin" cx="16" cy="16" r="14.2" /><circle className="rim" cx="16" cy="16" r="10.2" /><path d="M19.6 11.8a5.2 5.2 0 1 0 0 8.4M10.8 14.6h6.4M10.8 17.4h6.4" /></svg>
        <span>Munto</span>
      </Link>
      {links.map(link)}
      <button className="nav-more" type="button" aria-expanded={moreOpen} aria-controls="nav-more-sheet"
        data-current={inMore ? '' : undefined} onClick={() => setMoreOpen((o) => !o)}>
        <Icon name="more" />
        <span>More</span>
      </button>
      {moreOpen ? (
        <>
          <div className="nav-sheet" id="nav-more-sheet" role="menu">
            {links.filter((l) => !l[4]).map(([href, key, icon, label]) => (
              <Link key={key} href={href} role="menuitem" aria-current={pathname === href ? 'page' : undefined}>
                <Icon name={icon} /><span>{label}</span>
              </Link>
            ))}
            <button type="button" role="menuitem" onClick={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}>
              <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'auto'} /><span>{`Theme: ${THEME_NAMES[theme].toLowerCase()}`}</span>
            </button>
          </div>
        </>
      ) : null}
      <button className="theme-toggle" type="button" onClick={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}>
        <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'auto'} />
        {`Theme: ${THEME_NAMES[theme].toLowerCase()}`}
      </button>
    </nav>
  );
}
