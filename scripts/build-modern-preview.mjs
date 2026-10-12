import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { build } from 'esbuild';

// Package the actual Pages build in one portable file for visual review. The
// same React app runs local commands, native voice and its real preferences.
// Personal/server integrations remain in the full app, not a copied mockup.
const directory = resolve('dist-pages');
const index = await readFile(resolve(directory, 'index.html'), 'utf8');
const jsPath = index.match(/<script[^>]+src="([^"]+)"/)?.[1];
const cssPath = index.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
if (!jsPath || !cssPath) throw new Error('Execute npm run build:pages antes de exportar a prévia.');
// Include the lazy local-command module too. Inlining only the entry file
// would leave a relative import that cannot work in the portable HTML.
const [bundle, css] = await Promise.all([
  build({ entryPoints: [resolve(directory, 'assets', basename(jsPath))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2020', minify: true }),
  readFile(resolve(directory, 'assets', basename(cssPath)), 'utf8'),
]);
const js = bundle.outputFiles[0].text;
const license = await readFile('public/modern-reference-license.txt', 'utf8');
const html = `<!doctype html>\n<!-- SVG icons license:\n${license}\n-->\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JARVIS — Moderna</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>\n`;
await mkdir('artifacts/modern-preview', { recursive: true });
await writeFile('artifacts/modern-preview/jarvis-moderna-preview.html', html);
console.log('Prévia portátil: artifacts/modern-preview/jarvis-moderna-preview.html (modo navegador, sem dados da conta).');
