import { test, expect, type Page } from '@playwright/test';
const client = { 'X-Jarvis-Client': '1' };
const content = '# React\n\n## Efeitos\nuseEffect sincroniza sistemas externos. [[Estado|Estado local]]\n<script>window.__unsafeObsidian = true</script>\n';
async function enter(page: Page) {
  await page.goto('/'); await page.getByLabel('Senha pessoal').fill('fixture-local-personal-123');
  await page.getByRole('button', { name: 'Entrar no JARVIS' }).click();
  await expect(page.getByRole('button', { name: 'Notas do Obsidian', exact: true })).toBeVisible();
}
async function select(page: Page, name: string, body: string) {
  await page.getByLabel('Selecionar notas Markdown', { exact: true }).setInputFiles({ name, mimeType: 'text/markdown', buffer: Buffer.from(body) });
  await expect(page.getByRole('region', { name: 'Revisar importação' })).toBeVisible();
}
test('seleção revisada, descarte, importação, busca e leitura segura de Markdown', async ({ page }) => {
  await enter(page); await page.getByRole('button', { name: 'Notas do Obsidian', exact: true }).click();
  await select(page, 'React.md', content);
  expect((await (await page.request.get('/api/personal/data')).json()).library).toEqual([]);
  await page.getByRole('button', { name: 'Descartar seleção' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar importação' })).toHaveCount(0);
  await select(page, 'React.md', content); await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Importação salva');
  await page.getByLabel('Buscar nas notas importadas').fill('useEffect'); await page.getByRole('button', { name: 'Buscar trechos' }).click();
  const sources = page.getByRole('region', { name: 'Notas consultadas' });
  await sources.locator('summary').first().click(); await expect(sources).toContainText('useEffect sincroniza');
  await sources.getByRole('button', { name: 'Abrir nota: React', exact: true }).click();
  const note = page.getByRole('article', { name: 'Nota React', exact: true });
  await expect(note).toContainText('<script>window.__unsafeObsidian');
  expect(await page.evaluate(() => (window as unknown as { __unsafeObsidian?: boolean }).__unsafeObsidian)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('useEffect sincroniza');
  await note.scrollIntoViewIfNeeded(); await page.screenshot({ path: test.info().outputPath('knowledge.png'), fullPage: true });
  await page.reload(); await page.getByRole('button', { name: 'Notas do Obsidian', exact: true }).click();
  await expect(page.getByRole('button', { name: 'React React.md', exact: true })).toBeVisible();
});
test('outro aparelho recebe notas e atualização exige autorização sem sobrescrever revisão antiga', async ({ page, browser }) => {
  await enter(page); await page.getByRole('button', { name: 'Notas do Obsidian', exact: true }).click();
  await select(page, 'Rotina.md', '# Rotina\nCaminhar de manhã.'); await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Importação salva');
  const initial = await (await page.request.get('/api/personal/data')).json();
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const second = await context.newPage(); await enter(second); await second.getByRole('button', { name: 'Notas do Obsidian', exact: true }).click();
    await expect(second.getByRole('button', { name: 'Rotina Rotina.md', exact: true })).toBeVisible();
    await select(second, 'Rotina.md', '# Rotina\nCaminhar à tarde.'); await second.getByRole('button', { name: 'Confirmar importação' }).click();
    await expect(second.getByRole('alert')).toContainText('Marque a atualização');
    await second.getByLabel('Atualizar também as cópias com o mesmo caminho').check();
    await second.getByRole('button', { name: 'Confirmar importação' }).click(); await expect(second.getByRole('dialog').getByRole('status')).toContainText('1 atualizada');
    const stale = await page.request.post('/api/personal/knowledge/import', { headers: client, data: { files: [{ path: 'Rotina.md', content: '# Rotina\nDado antigo.' }], libraryRevision: initial.libraryRevision, replace: true } });
    expect(stale.status()).toBe(409);
    await page.reload(); await page.getByRole('button', { name: 'Notas do Obsidian', exact: true }).click(); await page.getByRole('button', { name: 'Rotina Rotina.md', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Nota Rotina' })).toContainText('Caminhar à tarde');
    await expect(page.getByRole('article', { name: 'Nota Rotina' })).not.toContainText('Dado antigo');
  } finally { await context.close(); }
});
test('chat consulta notas reais mesmo com web marcada, preserva referências e remove só a cópia', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat')); await enter(page);
  await page.getByLabel('Pesquisar na web').check(); await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('O que eu já estudei sobre React no meu Obsidian?');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('log', { name: 'Mensagens da conversa' })).toContainText('useEffect sincroniza');
  await expect(page.getByRole('region', { name: 'Notas consultadas' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('region', { name: 'Notas consultadas' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir modo voz' }).click();
  const sources = page.getByRole('region', { name: 'Notas consultadas' }); await sources.locator('summary').first().click();
  await sources.getByRole('button', { name: 'Abrir nota: React', exact: true }).click(); await expect(page.getByRole('article', { name: 'Nota React' })).toBeVisible();
  await page.getByRole('button', { name: 'Remover cópia: React', exact: true }).click(); await page.getByRole('button', { name: 'Cancelar remoção' }).click();
  await expect(page.getByRole('article', { name: 'Nota React' })).toBeVisible();
  await page.getByRole('button', { name: 'Remover cópia: React', exact: true }).click(); await page.getByRole('button', { name: 'Confirmar remoção da cópia' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Cópia removida');
  const data = await (await page.request.get('/api/personal/data')).json();
  expect(data.library.some((note: { path: string }) => note.path === 'React.md')).toBe(false);
  expect(data.history.at(-1).knowledgeSources).toEqual([]);
});
