import { history } from '../e2e/ui';
import { expect, test, type Page } from '@playwright/test';

const password = 'fixture-local-personal-123';
const client = { 'X-Jarvis-Client': '1' };
async function enter(page: Page) {
  await page.goto('/'); await page.getByLabel('Senha pessoal').fill(password);
  await page.getByRole('button', { name: 'Entrar no JARVIS' }).click();
  await expect(page.getByRole('button', { name: 'Preferências' })).toBeVisible();
}
async function memory(page: Page) {
  await page.getByRole('button', { name: 'Preferências' }).click();
  await page.getByRole('button', { name: 'Memória pessoal', exact: true }).click();
}

test('login, memória por consentimento, recarga sem cache privado e logout', async ({ page }) => {
  await page.goto('/'); await expect(page.getByLabel('Senha pessoal')).toBeVisible();
  await page.getByLabel('Senha pessoal').fill('fixture-errada'); await page.getByRole('button', { name: 'Entrar no JARVIS' }).click();
  await expect(page.getByRole('alert')).toHaveText('Senha incorreta.'); await enter(page);
  await page.request.delete('/api/personal/memories', { headers: client });
  await memory(page); await page.getByLabel('O que deseja que o JARVIS lembre?').fill('Prefiro estudar à noite');
  await page.getByRole('button', { name: 'Guardar memória' }).click();
  await expect(page.getByText('Prefiro estudar à noite', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar memória: Prefiro estudar à noite' }).click();
  await page.getByLabel('Editar informação').fill('Prefiro estudar de manhã');
  await page.getByRole('button', { name: 'Salvar alteração', exact: true }).click();
  await expect(page.getByText('Prefiro estudar de manhã', { exact: true })).toBeVisible();
  await expect(page.getByText('Prefiro estudar à noite', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Editar memória: Prefiro estudar de manhã' }).click();
  await page.getByLabel('Editar informação').fill('Alteração que não será salva');
  await page.getByRole('button', { name: 'Cancelar edição' }).click();
  await expect(page.getByText('Prefiro estudar de manhã', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload(); await memory(page); await expect(page.getByText('Prefiro estudar de manhã', { exact: true })).toBeVisible();
  const cache = await page.evaluate(() => localStorage.getItem('jarvis.history.v1'));
  expect(cache).toBeNull();
  await page.getByRole('button', { name: 'Apagar memória: Prefiro estudar de manhã' }).click();
  await expect(page.getByText('Prefiro estudar de manhã', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(page.getByLabel('Senha pessoal')).toBeVisible();
  expect((await page.request.get('/api/personal/data')).status()).toBe(401);
});

test('outro aparelho recebe história e notas; limpar sincroniza e preserva notas', async ({ page, browser }) => {
  await enter(page);
  await page.request.delete('/api/personal/history', { headers: client });
  await page.request.post('/api/chat', { headers: client, data: { message: 'anotar lembrar consulta', sessionId: crypto.randomUUID(), timeZone: 'America/Sao_Paulo' } });
  await memory(page);
  await page.getByLabel('Seu nome', { exact: true }).fill('Erik');
  await page.getByLabel('Como o JARVIS deve chamar você?').fill('senhor');
  await page.getByRole('button', { name: 'Salvar perfil', exact: true }).click();
  await expect(page.getByText('meu nome é Erik', { exact: true })).toBeVisible();
  const secondContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const second = await secondContext.newPage(); await enter(second);
    await memory(second);
    await expect(second.getByLabel('Seu nome', { exact: true })).toHaveValue('Erik');
    await expect(second.getByLabel('Como o JARVIS deve chamar você?')).toHaveValue('senhor');
    // Start an unsaved edit on the first device, then change the same profile on the second.
    await page.getByLabel('Seu nome', { exact: true }).fill('Primeiro aparelho');
    await second.getByLabel('Seu nome', { exact: true }).fill('Segundo aparelho');
    await second.getByRole('button', { name: 'Salvar perfil', exact: true }).click();
    await expect(second.getByText('meu nome é Segundo aparelho', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Salvar perfil', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Seu perfil mudou em outro aparelho');
    const nameReply = await second.request.post('/api/chat', { headers: client, data: { message: 'qual é meu nome', sessionId: crypto.randomUUID(), timeZone: 'America/Sao_Paulo' } });
    expect((await nameReply.json()).message).toBe('Seu nome é Segundo aparelho, senhor.');
    await second.getByRole('button', { name: 'Fechar janela' }).click();
    await history(second);
    await expect(second.getByRole('dialog').getByText('anotar lembrar consulta', { exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Limpar conversa', exact: true }).click();
    await second.getByRole('button', { name: 'Limpar conversa', exact: true }).click();
    await expect(second.getByRole('dialog')).toHaveCount(0);
    const state = await (await page.request.get('/api/personal/data')).json();
    expect(state.history).toHaveLength(0); expect(state.notes.some((note: { content: string }) => note.content === 'lembrar consulta')).toBe(true);
    expect(state.memories.some((memory: { content: string }) => memory.content === 'meu nome é Segundo aparelho')).toBe(true);
    await page.reload(); await history(page);
    await expect(page.getByText('anotar lembrar consulta', { exact: true })).toHaveCount(0);
  } finally { await secondContext.close(); }
});

test('sessão revogada bloqueia a interface ao voltar e importação é explícita', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.history.v1', JSON.stringify([{ id: 'antigo', role: 'user', content: 'Conversa antiga do navegador', createdAt: '2026-10-09T12:00:00Z' }])));
  await enter(page); await page.request.delete('/api/personal/history', { headers: client });
  expect((await (await page.request.get('/api/personal/data')).json()).history).toHaveLength(0);
  await memory(page); await page.getByRole('button', { name: 'Importar histórico deste navegador' }).click();
  await expect(page.getByRole('button', { name: 'Histórico importado' })).toBeVisible();
  const state = await (await page.request.get('/api/personal/data')).json();
  expect(state.history.some((message: { content: string }) => message.content === 'Conversa antiga do navegador')).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('jarvis.history.v1'))).toBeNull();
  await page.request.post('/api/personal/logout', { headers: client });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Senha pessoal')).toBeVisible();
});
