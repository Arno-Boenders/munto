// Renders build/icon.svg to build/icon.png (1024 x 1024, transparent around the rounded square) and
// build/tray.svg to the menu-bar icon (trayTemplate.png and @2x), with Electron's own renderer, so no image
// tools are needed. Run with `npm run icon` after changing an SVG.
import { app, BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');

app.dock?.hide();
app.on('window-all-closed', () => {}); // keep going between images; we quit when done
// Renders an SVG at 1024 x 1024 and returns it as a NativeImage.
async function render(file) {
  const svg = await readFile(join(build, file), 'utf8');
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  win.webContents.setZoomFactor(1);
  // The SVG goes in as an image (an image can't run script or load anything), on a page that may load
  // nothing else and can't open windows or navigate away.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"></head>`
    + `<body style="margin:0;background:transparent"><img src="${src}" width="1024" height="1024" style="display:block"></body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  win.destroy();
  return image.getSize().width === 1024 ? image : image.resize({ width: 1024, height: 1024, quality: 'best' });
}

app.whenReady().then(async () => {
  await writeFile(join(build, 'icon.png'), (await render('icon.svg')).toPNG());
  // The menu-bar icon: 18 pt, and 36 px for Retina screens.
  const tray = await render('tray.svg');
  await writeFile(join(build, 'trayTemplate.png'), tray.resize({ width: 18, height: 18, quality: 'best' }).toPNG());
  await writeFile(join(build, 'trayTemplate@2x.png'), tray.resize({ width: 36, height: 36, quality: 'best' }).toPNG());
  console.log('build/icon.png, build/trayTemplate.png and @2x written');
  app.quit();
});
