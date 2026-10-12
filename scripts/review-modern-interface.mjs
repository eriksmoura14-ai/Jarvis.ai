import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5173';
const directory = resolve('artifacts/modern-preview'); await mkdir(directory, { recursive: true });
const html = await readFile('docs/reference/jarvis-moderno-referencia.html', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] });
// Controlled reference identity for visual comparisons, not account data.
const snapshot = { history: [], memories: [{ id: 'fixture-name', content: 'Meu nome é Erik Moura' }, { id: 'fixture-address', content: 'Me chame de Erik' }], notes: [], generation: 0, storage: 'sqlite', projects: [], projectsRevision: 0, library: [], libraryRevision: 0 };
const selectors = ['#jarvis-moderno', '.jd-sidebar', '.jd-brand', '.jd-new', 'nav', '.jd-top', '.jd-orb', 'canvas', '.jp-status', '.jd-welcome', 'h2', '.jd-content', '.jd-suggestions', '.jd-composer', '.jd-compose-bottom', '.jd-mic', '.jd-send', '.jd-profile'];
const measure = page => page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
  const element = document.querySelector(selector), box = element.getBoundingClientRect(), css = getComputedStyle(element);
  return [selector, { x: box.x, y: box.y, width: box.width, height: box.height, color: css.color, background: css.backgroundColor, font: css.font, padding: css.padding, margin: css.margin, border: css.border, radius: css.borderRadius }];
})), selectors);
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', timezoneId: 'America/Sao_Paulo' });
    await context.addInitScript(() => { Math.random = () => .5; localStorage.setItem('jarvis.view.v1', 'chat'); localStorage.setItem('jarvis.voice.v2', 'false'); });
    const app = await context.newPage(); await app.clock.install({ time: new Date('2026-10-11T22:00:00Z') });
    await app.route('**/api/personal/session', route => route.fulfill({ json: { enabled: true, authenticated: true, storage: 'sqlite' } }));
    await app.route('**/api/personal/data', route => route.fulfill({ json: snapshot }));
    await app.goto(base); await app.getByRole('button', { name: 'Preferências' }).filter({ hasText: 'Sistema online' }).waitFor();
    const reference = await context.newPage();
    await reference.route('**/__reference/moderna', route => route.fulfill({ contentType: 'text/html', body: html }));
    await reference.goto(base + '/__reference/moderna');
    // Normalize only the connection label; preserve the approved file's footer
    // in these side-by-side captures so intentional copy changes remain visible.
    await reference.locator('.jd-preview').evaluate(element => element.textContent = 'Sistema online');
    await app.screenshot({ path: resolve(directory, name + '.png'), fullPage: true });
    await reference.screenshot({ path: resolve(directory, 'reference-' + name + '.png'), fullPage: true });
    const original = await measure(reference), actual = await measure(app);
    const differences = selectors.filter(selector => JSON.stringify(original[selector]) !== JSON.stringify(actual[selector]));
    await writeFile(resolve(directory, 'measures-' + name + '.json'), JSON.stringify({ viewport: { width, height }, reference: original, actual, differences }, null, 2));
    if (differences.length) throw new Error(name + ': diferenças encontradas em ' + differences.join(', '));
    console.log(name + ': medidas, fontes, cores e bordas coincidem.'); await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.goto(base); await page.locator('#jarvis-moderno canvas').waitFor();
  const timing = await page.evaluate(() => new Promise(resolve => {
    const intervals = []; let previous = 0;
    const sample = time => {
      if (previous) intervals.push(time - previous); previous = time;
      if (intervals.length < 120) requestAnimationFrame(sample);
      else { intervals.sort((a, b) => a - b); resolve({ frames: intervals.length, medianMs: intervals[60], p95Ms: intervals[114], context: 'Chromium, viewport 390x844; não é medição de celular físico' }); }
    };
    requestAnimationFrame(sample);
  }));
  await writeFile(resolve(directory, 'animation-timing.json'), JSON.stringify(timing, null, 2)); console.log(JSON.stringify(timing));
  await context.close();
} finally { await browser.close(); }
