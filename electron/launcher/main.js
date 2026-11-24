// Munto.app: a small launcher that runs the app from your project folder (written into source.json by
// `npm run app:install`). Your .env, keys and code stay there; updating is a pull and a rebuild, not a new app.
import { app, dialog } from 'electron';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let source = null;
try {
  ({ source } = JSON.parse(readFileSync(join(here, 'source.json'), 'utf8')));
  await import(pathToFileURL(join(source, 'electron', 'main.js')).href);
} catch (err) {
  app.whenReady().then(() => {
    dialog.showErrorBox('Munto can’t start', `It couldn’t load the app from ${source ?? 'your project folder'}.\n\n${err.message}\n\nRun npm run app:install in the project folder again.`);
    app.quit();
  });
}
