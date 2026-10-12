import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { prepare, completeRecognition } from './voice-cases';

const reference = readFileSync(new URL('../docs/reference/jarvis-moderno-referencia.html', import.meta.url), 'utf8');
test('Moderna preserva a referência aprovada nas mesmas dimensões', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    Math.random = () => .5; localStorage.setItem('jarvis.voice.v2', 'false'); localStorage.setItem('jarvis.view.v1', 'chat');
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: undefined });
  });
  await page.clock.install({ time: new Date('2026-10-11T22:00:00Z') });
  await page.route('**/api/personal/session', route => route.fulfill({ json: { enabled: true, authenticated: true, storage: 'sqlite' } }));
  const snapshot = { history: [] as unknown[], memories: [{ id: 'fixture-name', content: 'Meu nome é Erik Moura' }, { id: 'fixture-address', content: 'Me chame de Erik' }], notes: [], generation: 0, storage: 'sqlite', projects: [], projectsRevision: 0, library: [], libraryRevision: 0 };
  await page.route('**/api/personal/data', route => route.fulfill({ json: snapshot }));
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Preferências' })).toHaveText('Sistema online');
  // Both variants have real dynamic identity/connection/privacy text. Only
  // replace those strings in the reference used for comparison, never its CSS.
  const original = await context.newPage(); await original.emulateMedia({ reducedMotion: 'reduce' });
  await original.route('**/__reference/moderna', route => route.fulfill({ contentType: 'text/html', body: reference }));
  await original.goto('/__reference/moderna');
  await original.locator('.jd-preview').evaluate(element => element.textContent = 'Sistema online');
  await original.locator('.jd-disclosure').evaluate(element => element.textContent = 'Histórico na sua conta · microfone ativado apenas com seu toque');
  // Greeting follows the browser's timezone rather than inventing a profile.
  const greeting = await page.locator('.jd-welcome h2').textContent();
  await original.locator('.jd-welcome h2').evaluate((element, text) => element.textContent = text, greeting);
  const selectors = ['#jarvis-moderno', '.jd-sidebar', '.jd-brand', '.jd-new', 'nav', '.jd-top', '.jd-orb', 'canvas', '.jp-status', '.jd-welcome', 'h2', '.jd-content', '.jd-suggestions', '.jd-composer', '.jd-compose-bottom', '.jd-mic', '.jd-send', '.jd-profile'];
  const measure = (target: typeof page) => target.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const element = document.querySelector(selector)!; const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
    return [selector, { x: box.x, y: box.y, width: box.width, height: box.height, color: style.color, background: style.backgroundColor, font: style.font, padding: style.padding, margin: style.margin, border: style.border, radius: style.borderRadius }];
  })), selectors);
  expect(await measure(page)).toEqual(await measure(original));
  const icons = (target: typeof page) => target.locator('.jd-sidebar nav svg,.jd-suggestions svg,.jd-compose-bottom svg').evaluateAll(icons => icons.map(icon => icon.innerHTML));
  expect(await icons(page)).toEqual(await icons(original));
  await page.screenshot({ path: test.info().outputPath('moderna.png'), fullPage: true });
  await original.screenshot({ path: test.info().outputPath('reference.png'), fullPage: true });
  // Compare the live chat card as well as the empty welcome screen. Only its
  // response content is normalized; the original simulated answer is not an
  // application implementation.
  await page.route('**/api/chat', route => {
    const reply = { id: 'fixture-visual-answer', message: 'O resultado é 7.', provider: 'local', createdAt: new Date().toISOString() };
    snapshot.history = [{ id: 'fixture-visual-user', role: 'user', content: 'calcular 3 + 4', createdAt: reply.createdAt }, { ...reply, role: 'assistant', content: reply.message }];
    return route.fulfill({ json: reply });
  });
  await page.getByRole('textbox').fill('calcular 3 + 4'); await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText('O resultado é 7.', { exact: true })).toBeVisible();
  await original.clock.install({ time: new Date('2026-10-11T22:00:00Z') }); await original.clock.pauseAt(new Date('2026-10-11T22:01:00Z'));
  await original.locator('input').fill('calcular 3 + 4'); await original.locator('.jd-send').click();
  await original.locator('.jd-chat > div').evaluate(element => element.textContent = 'O resultado é 7.');
  await original.evaluate(() => document.getElementById('jarvis-moderno')!.dispatchEvent(new CustomEvent('jarvis-state', { detail: 'idle' })));
  selectors.splice(selectors.indexOf('.jd-suggestions'), 1, '.jd-chat');
  expect(await measure(page)).toEqual(await measure(original));
  await page.screenshot({ path: test.info().outputPath('moderna-chat.png'), fullPage: true });
  await original.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText(/ações simuladas|Demonstração de aparência|Prévia visual/)).toHaveCount(0);
});

test('Canvas segue escuta, processamento, fala e interrupção reais, e respeita pausa', async ({ page }) => {
  await prepare(page);
  const canvas = page.locator('.jd-orb canvas');
  await expect(canvas).toHaveAttribute('data-state', 'idle');
  await page.getByRole('button', { name: 'Pausar animação' }).click();
  await expect(canvas).toHaveAttribute('data-paused', 'true');
  await page.getByRole('button', { name: 'Iniciar animação' }).click();
  let release = () => {}; const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/chat', async route => { await ready; await route.fulfill({ json: { id: 'fixture-real-state', createdAt: new Date().toISOString(), message: 'O resultado é 7.', provider: 'local' } }); });
  await page.getByRole('button', { name: 'Falar com JARVIS' }).click(); await expect(canvas).toHaveAttribute('data-state', 'listening');
  await completeRecognition(page, 'calcular 2 + 5'); await expect(canvas).toHaveAttribute('data-state', 'thinking');
  release(); await expect(canvas).toHaveAttribute('data-state', 'speaking');
  await page.getByRole('button', { name: 'Interromper resposta' }).click(); await expect(canvas).toHaveAttribute('data-state', 'idle');
  await expect(page.getByText('O resultado é 7.', { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(canvas).toHaveAttribute('data-paused', 'true');
});

test('menu sem conta informa indisponibilidade e mantém a conversa utilizável', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Projetos', 'Tarefas', 'Memória']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.jd-content')).toContainText('exige o acesso à sua conta pessoal');
  }
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('calcular 3 + 4');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText('O resultado é 7.', { exact: true })).toBeVisible();
});
