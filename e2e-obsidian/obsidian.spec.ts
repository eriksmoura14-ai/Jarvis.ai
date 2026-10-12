import { knowledge } from '../e2e/ui';
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
const headers = { 'X-Jarvis-Client': '1' }; const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function enter(page: Page) {
  await page.goto('/'); await page.getByLabel('Senha pessoal').fill('fixture-local-personal-123'); await page.getByRole('button', { name: 'Entrar no JARVIS' }).click();
  await knowledge(page);
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
  await page.reload(); await knowledge(page); await page.getByText('Conectar Obsidian do Android', { exact: true }).click(); await expect(tokenInput).toHaveCount(0);
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
  await page.reload(); await knowledge(page);
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

test('sincroniza 121 notas em lotes e mostra capacidade ampliada preservando a primeira cópia', async ({ page }) => {
  await enter(page);
  const grant = await (await page.request.post('/api/personal/obsidian/devices', { headers, data: { name: 'Cofre maior' } })).json();
  const deviceHeaders = { ...headers, Authorization: `Bearer ${grant.token}` };
  const original = { path: 'Objetivos/Antiga.md', content: '# Nota antiga\nObjetivo já importado.', baseHash: null };
  expect((await page.request.post('/api/obsidian/sync', { headers: deviceHeaders, data: { changes: [original], known: [] } })).status()).toBe(200);
  const before = await (await page.request.get('/api/personal/data')).json(); const originalSummary = before.library.find((note: { path: string }) => note.path === original.path);
  const notes = Array.from({ length: 120 }, (_, index) => ({ path: `Objetivos/Nota-${index}.md`, content: `# Objetivo ${index}\nEstudar e registrar o plano ${index}.`, baseHash: null }));
  const known = [{ path: original.path, hash: hash(original.content) }];
  for (let offset = 0; offset < notes.length; offset += 20) {
    const changes = notes.slice(offset, offset + 20);
    const response = await page.request.post('/api/obsidian/sync', { headers: deviceHeaders, data: { changes, known } });
    expect(response.status()).toBe(200); const result = await response.json(); expect(result.conflicts).toEqual([]); expect(result.acknowledged).toHaveLength(20);
    known.push(...result.acknowledged);
  }
  const idle = await page.request.post('/api/obsidian/sync', { headers: deviceHeaders, data: { changes: [], known } });
  expect(idle.status()).toBe(200); expect((await idle.json()).updates).toEqual([]);
  const after = await (await page.request.get('/api/personal/data')).json();
  expect(after.library).toHaveLength(before.library.length + 120); expect(after.library.find((note: { id: string }) => note.id === originalSummary.id)).toEqual(originalSummary);
  for (const note of before.library) expect(after.library).toContainEqual(note);
  await page.reload(); await knowledge(page);
  await expect(page.getByText(/\d+ de 1\.000 notas.*MB de 10 MB/)).toContainText(`${before.library.length + 120} de 1.000 notas`);
  await page.getByRole('button', { name: 'Objetivo 119 Objetivos/Nota-119.md', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Nota Objetivo 119', exact: true })).toContainText('registrar o plano 119');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
