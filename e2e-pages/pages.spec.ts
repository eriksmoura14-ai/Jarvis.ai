import { test, expect } from '@playwright/test';

test('chat, notas e histórico funcionam sem API no caminho do GitHub Pages', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.route('**/api/**', route => route.abort());
  await page.goto('./');
  await expect(page.getByText('Modo navegador', { exact: true })).toBeVisible();
  await expect(page.getByText('Neste navegador', { exact: true })).toBeVisible();
  const send = async (text: string) => {
    await page.getByRole('textbox').fill(text);
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  };
  await send('calcular (12 + 8) / 2');
  await expect(page.getByText('O resultado é 10.', { exact: true })).toBeVisible();
  await send('anotar publicar meu portfólio');
  await expect(page.getByText('Nota salva: publicar meu portfólio', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Nota salva: publicar meu portfólio', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar conversa', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Limpar conversa' }).click();
  await page.getByRole('button', { name: 'Minhas notas' }).click();
  await expect(page.getByText(/1\. publicar meu portfólio/)).toBeVisible();
  await send('apagar notas');
  await expect(page.getByText('1 nota excluída.', { exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const favicon = await page.request.get('./favicon.svg');
  expect(favicon.ok()).toBe(true);
});
test('limites de dados da versão estática são informados corretamente', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Preferências' }).click();
  await expect(page.getByRole('dialog')).toContainText('sem enviar a conversa a uma API');
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await page.getByRole('button', { name: 'Comandos', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Guardar uma nota neste navegador');
});
