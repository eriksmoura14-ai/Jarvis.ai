import { test, expect } from '@playwright/test';

test('pesquisa automática exige backend, sem botão web, e preserva fontes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await page.goto('./');
  await expect(page.getByRole('checkbox', { name: 'Pesquisar na web' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('pesquise React');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('alert')).toContainText('backend conectado');
  await page.addInitScript(() => localStorage.setItem('jarvis.backend.v1', 'https://jarvis-api.example'));
  const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  const calls: { message: string; webSearch?: boolean }[] = [];
  await page.route('https://jarvis-api.example/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith('/api/health')) return route.fulfill({ headers, json: { status: 'ok', provider: 'groq', version: '0.1.0', webSearch: { enabled: true }, ai: { configured: true, provider: 'groq', model: 'test' } } });
    calls.push(route.request().postDataJSON());
    await route.fulfill({ headers, json: { id: 'search', message: 'Os preços do PS5 variam conforme a oferta [1].', createdAt: new Date().toISOString(), provider: 'groq', command: 'search', sources: [{ title: 'Informações do PS5', url: 'https://www.playstation.com/pt-br/ps5/', snippet: 'Informações sobre modelos e ofertas.' }], webSearch: { query: 'preço PS5 hoje', engine: 'bing', searchedAt: new Date().toISOString() } } });
  });
  await page.reload();
  await expect(page.getByText(/Pesquisa automática ativa/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('Qual o preço do PS5 hoje?');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('region', { name: 'Fontes da pesquisa' })).toBeVisible();
  expect(calls).toEqual([expect.objectContaining({ message: 'Qual o preço do PS5 hoje?' })]);
  expect(calls[0].webSearch).toBeUndefined();
  await page.reload();
  await expect(page.getByRole('link', { name: /Informações do PS5/ })).toBeVisible();
});
