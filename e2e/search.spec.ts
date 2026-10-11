import { test, expect } from '@playwright/test';
import { prepare, completeRecognition } from './voice-cases';

const response = {
  id: 'search-reply', provider: 'groq', command: 'search', message: 'React usa componentes reutilizáveis [1].', createdAt: '2026-10-10T00:00:00Z',
  sources: [{ title: 'Documentação oficial do React', url: 'https://react.dev/learn', snippet: 'Crie componentes.' }],
  webSearch: { query: 'React', engine: 'duckduckgo', searchedAt: '2026-10-10T00:00:00Z' },
};

test('pesquisa explícita mostra links seguros no chat e restaura fontes no histórico', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  let request: { webSearch?: boolean; message: string } | undefined;
  await page.route('**/api/chat', route => { request = route.request().postDataJSON(); return route.fulfill({ json: response }); });
  await page.goto('/');
  await expect(page.getByRole('checkbox', { name: 'Pesquisar na web' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('pesquise React');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('region', { name: 'Fontes da pesquisa' })).toBeVisible();
  expect(request).toMatchObject({ message: 'pesquise React' });
  expect(request?.webSearch).toBeUndefined();
  const link = page.getByRole('link', { name: /Documentação oficial do React/ });
  await expect(link).toHaveAttribute('href', 'https://react.dev/learn');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('.message-badge').last()).toHaveText('WEB');
  await page.reload();
  await expect(link).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Abrir modo voz' }).click();
  await expect(page.locator('.scene-response').getByRole('region', { name: 'Fontes da pesquisa' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir histórico' }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: /Documentação oficial do React/ })).toBeVisible();
});

test('busca bloqueada preserva o pedido e não mostra fontes falsas', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await page.route('**/api/chat', route => route.fulfill({ status: 503, json: { error: 'Não consegui consultar a web agora.' } }));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('pesquise React');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('alert')).toContainText('Não consegui consultar a web');
  await expect(page.getByRole('textbox')).toHaveValue('pesquise React');
  await expect(page.getByRole('region', { name: 'Fontes da pesquisa' })).toHaveCount(0);
});

test('recusa uma URL executável recebida do backend', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await page.route('**/api/chat', route => route.fulfill({ json: { ...response, sources: [{ ...response.sources[0], url: 'javascript:alert(1)' }] } }));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('pesquise React');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('alert')).toContainText('fontes de pesquisa inválidas');
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
});

test('comando falado pesquisa e sintetiza só a resposta; fontes ficam acessíveis', async ({ page }) => {
  const calls: { message: string }[] = [];
  await page.route('**/api/chat', route => { calls.push(route.request().postDataJSON()); return route.fulfill({ json: response }); });
  await prepare(page);
  await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
  await expect(page.getByRole('status')).toContainText('À escuta');
  await completeRecognition(page, 'Jarvis, pesquise React');
  await expect(page.locator('.scene-reply')).toContainText('componentes reutilizáveis');
  await expect(page.getByRole('link', { name: /Documentação oficial do React/ })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].message).toBe('Jarvis, pesquise React');
  const spoken = await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken);
  expect(spoken).toEqual(['React usa componentes reutilizáveis.']);
});

test('uma pesquisa falha no modo voz não apresenta nem reproduz a resposta anterior', async ({ page }) => {
  await page.addInitScript(response => localStorage.setItem('jarvis.history.v1', JSON.stringify([
    { id: 'old-user', role: 'user', content: 'pesquise React', createdAt: response.createdAt },
    { ...response, role: 'assistant', content: response.message },
  ])), response);
  await page.route('**/api/chat', route => route.fulfill({ status: 503, json: { error: 'Não encontrei notícias relacionadas ao assunto com data nos últimos sete dias.' } }));
  await prepare(page);
  await expect(page.locator('.scene-reply')).toContainText('componentes reutilizáveis');
  await page.getByRole('button', { name: 'Digitar mensagem' }).click();
  await page.getByRole('textbox').fill('Últimas notícias tecnologia e ia');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('alert')).toContainText('notícias relacionadas');
  await expect(page.getByRole('textbox')).toHaveValue('Últimas notícias tecnologia e ia');
  await expect(page.locator('.scene-reply')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Fontes da pesquisa' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ouvir resposta', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
  await page.getByRole('button', { name: 'Abrir histórico' }).click();
  await expect(page.getByRole('dialog')).toContainText('componentes reutilizáveis');
});

test('fontes mostram a data de publicação informada pelo feed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await page.route('**/api/chat', route => route.fulfill({ json: { ...response, sources: [{ ...response.sources[0], publishedAt: '2026-10-09T12:00:00Z' }] } }));
  await page.goto('/');
  await page.getByRole('textbox').fill('pesquise React');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('region', { name: 'Fontes da pesquisa' }).locator('time[datetime="2026-10-09T12:00:00Z"]')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Fontes da pesquisa' })).toContainText('Publicado em');
});

test('pesquisa automática mostra consultas complementares e restaura os detalhes sem exigir a opção web', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', provider: 'groq', model: 'fixture-model', webSearch: { enabled: true }, interpretation: { enabled: true } } }));
  let request: { webSearch?: boolean; message: string } | undefined;
  await page.route('**/api/chat', route => { request = route.request().postDataJSON(); return route.fulfill({ json: { ...response, webSearch: { ...response.webSearch, queries: ['React', 'TypeScript'], engines: ['bing', 'duckduckgo'] } } }); });
  await page.goto('/');
  await expect(page.getByText(/Pesquisa automática ativa/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Pesquisar na web' })).toHaveCount(0);
  await page.getByRole('textbox').fill('Compare as novidades de React e TypeScript');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  expect(request?.webSearch).not.toBe(true);
  const details = page.locator('details.search-queries');
  await expect(details.getByText('Consultas realizadas (2)')).toBeVisible();
  await details.locator('summary').click();
  await expect(details.locator('li')).toHaveText(['React', 'TypeScript']);
  await page.reload();
  await expect(details).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
