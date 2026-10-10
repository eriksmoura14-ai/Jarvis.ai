import { test, expect } from '@playwright/test';

test('pesquisa exige backend e envia até um comando reconhecido quando o modo web é explícito', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await page.goto('./');
  await expect(page.getByRole('checkbox', { name: 'Pesquisar na web' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('pesquise React');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('alert')).toContainText('backend conectado');
  await page.addInitScript(() => localStorage.setItem('jarvis.backend.v1', 'https://jarvis-api.example'));
  const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  const calls: { message: string; webSearch: boolean }[] = [];
  await page.route('https://jarvis-api.example/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith('/api/health')) return route.fulfill({ headers, json: { status: 'ok', provider: 'groq', version: '0.1.0', webSearch: { enabled: true }, ai: { configured: true, provider: 'groq', model: 'test' } } });
    calls.push(route.request().postDataJSON());
    await route.fulfill({ headers, json: { id: 'search', message: 'Fusos horários [1].', createdAt: new Date().toISOString(), provider: 'groq', command: 'search', sources: [{ title: 'Fusos horários', url: 'https://en.wikipedia.org/wiki/Time_zone', snippet: 'Um guia' }], webSearch: { query: 'hora', engine: 'bing', searchedAt: new Date().toISOString() } } });
  });
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Pesquisar na web' })).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Pesquisar na web' }).check();
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('hora');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('region', { name: 'Fontes da pesquisa' })).toBeVisible();
  expect(calls).toEqual([expect.objectContaining({ message: 'hora', webSearch: true })]);
  await page.reload();
  await expect(page.getByRole('link', { name: /Fusos horários/ })).toBeVisible();
});
