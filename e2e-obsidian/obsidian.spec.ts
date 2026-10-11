import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
const headers = { 'X-Jarvis-Client': '1' }; const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function enter(page: Page) {
  await page.goto('/'); await page.getByLabel('Senha pessoal').fill('fixture-local-personal-123'); await page.getByRole('button', { name: 'Entrar no JARVIS' }).click();
  await page.getByRole('button', { name: 'Notas do Obsidian', exact: true }).click();
}
test('vinculação Android revela chave uma vez e revoga sem expor notas no armazenamento local', async ({ page }) => {
  await enter(page); await page.getByText('Conectar Obsidian do Android', { exact: true }).click();
  await page.getByLabel('Nome do aparelho').fill('Android de teste'); await page.getByRole('button', { name: 'Gerar chave de vinculação' }).click();
  const tokenInput = page.getByLabel('Chave para o plugin'); await expect(tokenInput).toHaveValue(/^[a-f0-9]{64}$/); const token = await tokenInput.inputValue();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(token);
  const body = { changes: [{ path: 'Teste.md', content: '# Teste\nMinha nota do Android.', baseHash: null }], known: [] };
  const deviceHeaders = { ...headers, Authorization: `Bearer ${token}` };
  expect((await page.request.post('/api/obsidian/sync', { headers: deviceHeaders, data: body })).status()).toBe(200);
  await page.getByRole('button', { name: 'Ocultar chave' }).click(); await expect(tokenInput).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: 'Notas do Obsidian', exact: true }).click(); await page.getByText('Conectar Obsidian do Android', { exact: true }).click(); await expect(tokenInput).toHaveCount(0);
  await page.getByRole('button', { name: 'Revogar Android de teste', exact: true }).click(); await page.getByRole('button', { name: 'Confirmar revogação', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revogar Android de teste', exact: true })).toHaveCount(0);
  expect((await page.request.post('/api/obsidian/sync', { headers: deviceHeaders, data: body })).status()).toBe(401);
  expect((await (await page.request.get('/api/personal/data')).json()).library).toHaveLength(1);
});
test('editor envia mudança ao plugin e preserva rascunho quando outro aparelho edita', async ({ page }) => {
  await enter(page);
  const grant = await (await page.request.post('/api/personal/obsidian/devices', { headers, data: { name: 'Plugin fixture' } })).json();
  const deviceHeaders = { ...headers, Authorization: `Bearer ${grant.token}` };
  const initial = '# Rotina\nEstudar no celular.';
  await page.request.post('/api/obsidian/sync', { headers: deviceHeaders, data: { changes: [{ path: 'Rotina.md', content: initial, baseHash: null }], known: [] } });
  await page.reload(); await page.getByRole('button', { name: 'Notas do Obsidian', exact: true }).click();
  await page.getByRole('button', { name: 'Rotina Rotina.md', exact: true }).click(); await page.getByRole('button', { name: 'Editar nota', exact: true }).click();
  const draft = '# Rotina\nTexto digitado pelo Xbox.'; await page.getByLabel('Texto Markdown').fill(draft); await page.getByRole('button', { name: 'Salvar nota', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status').filter({ hasText: 'Nota salva' })).toContainText('Nota salva');
  const received = await (await page.request.post('/api/obsidian/sync', { headers: deviceHeaders, data: { changes: [], known: [{ path: 'Rotina.md', hash: hash(initial) }] } })).json();
  expect(received.updates).toEqual([{ path: 'Rotina.md', content: draft, hash: hash(draft) }]);
  await page.getByRole('button', { name: 'Editar nota', exact: true }).click(); const unsaved = '# Rotina\nMeu rascunho que não pode sumir.';
  await page.getByLabel('Texto Markdown').fill(unsaved);
  const data = await (await page.request.get('/api/personal/data')).json(); const note = data.library.find((note: { path: string }) => note.path === 'Rotina.md');
  expect((await page.request.put(`/api/personal/knowledge/${note.id}`, { headers, data: { content: '# Rotina\nOutro aparelho.', revision: note.revision } })).status()).toBe(200);
  await page.getByRole('button', { name: 'Salvar nota', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('rascunho foi preservado'); await expect(page.getByLabel('Texto Markdown')).toHaveValue(unsaved);
  await expect(page.getByRole('article', { name: 'Nota Rotina' })).toContainText('Outro aparelho');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(unsaved);
});
