import localFont from 'next/font/local';
import { connection } from 'next/server';
import { appConfig, uncategorisedCount } from '@/src/api.js';
import { AppProvider } from '@/components/app.jsx';
import { Nav } from '@/components/nav.jsx';
import './globals.css';

// Familjen Grotesk for everything, words and amounts (with its tabular figures in amounts). A variable
// font: every weight from 400 to 700 in one file (OFL licence in app/fonts).
const familjen = localFont({ src: './fonts/familjen-grotesk.ttf', weight: '400 700', display: 'swap', variable: '--font-familjen' });

export const metadata = {
  title: { template: '%s · Munto', default: 'Munto' },
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='14.2' fill='%23a9505f' stroke='%237a3442' stroke-width='1.6'/><circle cx='16' cy='16' r='10.2' fill='none' stroke='%237a3442' stroke-opacity='.55' stroke-width='1'/><path d='M19.6 11.8a5.2 5.2 0 1 0 0 8.4M10.8 14.6h6.4M10.8 17.4h6.4' fill='none' stroke='%23fde8eb' stroke-width='2.5' stroke-linecap='round'/></svg>",
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The browser's bar takes the colour of what's under it: the ground beside the page, or on a phone the
  // page itself (--paper / --sheet).
  themeColor: [
    { media: '(max-width: 760px) and (prefers-color-scheme: dark)', color: '#1d1323' },
    { media: '(max-width: 760px)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#120a16' },
    { media: '(prefers-color-scheme: light)', color: '#ece5ef' },
  ],
};

// Apply a saved theme before first paint (no flash). window.__themeColor repaints the browser's bar for a
// theme chosen in the app instead of the system's (useTheme calls it again when you switch).
const themeScript = `
window.__themeColor = function () {
  var t = document.documentElement.dataset.theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
    if (m.dataset.media == null) m.dataset.media = m.getAttribute('media') || '';
    var phone = m.dataset.media.indexOf('max-width') >= 0;
    var dark = t ? t === 'dark' : m.dataset.media.indexOf('dark') >= 0;
    m.setAttribute('media', t ? (phone ? '(max-width: 760px)' : '(min-width: 761px)') : m.dataset.media);
    m.setAttribute('content', phone ? (dark ? '#1d1323' : '#ffffff') : (dark ? '#120a16' : '#ece5ef'));
  });
};
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
document.addEventListener('DOMContentLoaded', window.__themeColor);`;

export default async function RootLayout({ children }) {
  await connection(); // always render per request: this is live bank data
  const config = await appConfig();
  return (
    <html lang="en" className={familjen.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppProvider config={JSON.parse(JSON.stringify(config))} uncategorised={uncategorisedCount()}>
          <a className="skip-link" href="#view">Skip to the page</a>
          <div className="shell">
            <Nav />
            <main id="view" tabIndex={-1}>{children}</main>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}
