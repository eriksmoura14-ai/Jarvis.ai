import { test, expect, type Page } from '@playwright/test';
const client = { 'X-Jarvis-Client': '1' };
async function enter(page: Page) {
  await page.goto('/'); await page.getByLabel('Senha pessoal').fill('fixture-local-personal-123');
  await page.getByRole('button', { name: 'Entrar no JARVIS' }).click();
  await expect(page.getByRole('button', { name: 'Projetos e tarefas', exact: true })).toBeVisible();
}
async function create(page: Page, title: string, steps: string) {
  await page.getByRole('button', { name: 'Projetos e tarefas', exact: true }).click();
  await page.getByLabel('Nome do projeto').fill(title); await page.getByLabel('Objetivo do projeto').fill('Um objetivo pessoal');
  await page.getByLabel('Etapas iniciais').fill(steps); await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await expect(page.getByRole('article', { name: `Projeto ${title}`, exact: true })).toBeVisible();
}
test('projeto, prazo, progresso, reabertura e arquivo persistem na conta', async ({ page }) => {
  await enter(page); await create(page, 'Meu inglês', 'Vocabulário\nConversação');
  const card = page.getByRole('article', { name: 'Projeto Meu inglês', exact: true });
  await card.getByRole('button', { name: 'Adicionar tarefa em Meu inglês', exact: true }).click();
  await page.getByLabel('Nome da tarefa').fill('Ouvir podcast'); await page.getByLabel('Prazo da tarefa').fill('2026-10-14');
  await page.getByRole('button', { name: 'Salvar tarefa', exact: true }).click();
  await expect(card).toContainText('14/10/2026');
  await card.getByRole('button', { name: 'Concluir tarefa: Vocabulário', exact: true }).click();
  await expect(card).toContainText('1 de 3 tarefas concluídas');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('projects.png'), fullPage: true });
  await card.getByRole('button', { name: 'Reabrir tarefa: Vocabulário', exact: true }).click();
  await expect(card).toContainText('0 de 3 tarefas concluídas');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.getByRole('button', { name: 'Arquivar projeto: Meu inglês', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Restaurar projeto: Meu inglês' })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Projetos e tarefas', exact: true }).click();
  await card.getByRole('button', { name: 'Restaurar projeto: Meu inglês', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await expect(page.getByRole('region', { name: 'Suas prioridades' })).toContainText('Ouvir podcast');
});
test('outro aparelho vê as tarefas e uma revisão antiga não sobrescreve alterações', async ({ page, browser }) => {
  await enter(page); await create(page, 'Portfólio', 'Revisar currículo');
  const initial = await (await page.request.get('/api/personal/data')).json();
  const project = initial.projects.find((project: { title: string }) => project.title === 'Portfólio');
  const secondContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const second = await secondContext.newPage(); await enter(second);
    await expect(second.getByRole('region', { name: 'Suas prioridades' })).toContainText('4 pendentes');
    await second.getByRole('button', { name: 'Projetos e tarefas', exact: true }).click();
    await expect(second.getByRole('article', { name: 'Projeto Portfólio', exact: true })).toContainText('Revisar currículo');
    await second.getByRole('article', { name: 'Projeto Portfólio', exact: true }).getByRole('button', { name: 'Concluir tarefa: Revisar currículo', exact: true }).click();
    const stale = await page.request.post('/api/personal/projects/change', { headers: client, data: { projectsRevision: initial.projectsRevision, change: { action: 'add_tasks', projectId: project.id, tasks: [{ title: 'Edição desatualizada' }] } } });
    expect(stale.status()).toBe(409);
    await page.reload(); await page.getByRole('button', { name: 'Projetos e tarefas', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Projeto Portfólio', exact: true })).toContainText('1 de 1 tarefas concluídas');
    await expect(page.getByText('Edição desatualizada', { exact: true })).toHaveCount(0);
  } finally { await secondContext.close(); }
});
test('proposta aparece para revisão, descartar não salva e confirmação falha permite tentar de novo', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await enter(page);
  const snapshot = await (await page.request.get('/api/personal/data')).json();
  const proposal = { id: crypto.randomUUID(), token: 'a'.repeat(64), generation: snapshot.generation, projectsRevision: snapshot.projectsRevision, expiresAt: new Date(Date.now() + 600000).toISOString(), change: { action: 'create_project', title: 'Plano proposto', description: 'Organizar meus estudos', tasks: [{ title: 'Revisar TypeScript', dueDate: '2026-10-15' }] } };
  // The model transport is simulated here. Signature and confirmation are tested against the real API in Vitest.
  await page.route('**/api/chat', route => route.fulfill({ json: { id: 'fixture-proposal-message', command: 'conversation', provider: 'groq', message: 'Proposta para revisar. Nada foi salvo.', createdAt: new Date().toISOString(), proposal } }));
  let attempts = 0;
  await page.route('**/api/personal/projects/confirm', async route => {
    expect(route.request().postDataJSON()).toEqual({ proposal });
    if (++attempts === 1) return route.fulfill({ status: 503, json: { error: 'Falha temporária ao salvar.' } });
    const response = await page.request.post('/api/personal/projects/change', { headers: client, data: { change: proposal.change, projectsRevision: proposal.projectsRevision } });
    return route.fulfill({ status: response.status(), json: await response.json() });
  });
  const send = async () => { await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('Monte um plano para meus estudos'); await page.getByRole('button', { name: 'Enviar mensagem' }).click(); };
  await send(); await expect(page.getByRole('region', { name: 'Revisar proposta do JARVIS' })).toContainText('15/10/2026');
  expect((await (await page.request.get('/api/personal/data')).json()).projects.some((project: { title: string }) => project.title === 'Plano proposto')).toBe(false);
  await page.getByRole('button', { name: 'Descartar proposta' }).click(); await expect(page.getByRole('button', { name: 'Confirmar proposta' })).toHaveCount(0);
  await send(); await page.getByRole('button', { name: 'Abrir modo voz' }).click();
  await expect(page.getByRole('region', { name: 'Revisar proposta do JARVIS' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar proposta' }).click(); await expect(page.getByRole('alert')).toContainText('Falha temporária');
  await page.getByRole('button', { name: 'Confirmar proposta' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar proposta' })).toHaveCount(0);
  const updated = await (await page.request.get('/api/personal/data')).json();
  expect(updated.projects.filter((project: { title: string }) => project.title === 'Plano proposto')).toHaveLength(1);
  await page.reload(); await page.getByRole('button', { name: 'Projetos e tarefas', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Projeto Plano proposto', exact: true })).toContainText('Revisar TypeScript');
});

test('planejamento usa notas reais, salva somente na confirmação e não duplica tarefas concluídas', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await enter(page);
  let initial = await (await page.request.get('/api/personal/data')).json();
  // This suite shares a temporary account. Finish the fixture tasks so the
  // daily plan can select the newly imported next steps, without deleting data.
  for (const project of initial.projects) for (const task of project.tasks) {
    if (project.archived || task.status !== 'pending') continue;
    const saved = await page.request.post('/api/personal/projects/change', { headers: client, data: { projectsRevision: initial.projectsRevision,
      change: { action: 'complete_task', projectId: project.id, taskId: task.id } } });
    expect(saved.status()).toBe(200); initial = await (await page.request.get('/api/personal/data')).json();
  }
  const content = '# Tarefas pessoais\n- [ ] Rever candidatura\n- [ ] Conferir orçamento\n- [x] Etapa já concluída';
  const imported = await page.request.post('/api/personal/knowledge/import', { headers: client, data: { files: [{ path: '04 Planejamento/Tarefas pessoais.md', content }], replace: false, libraryRevision: initial.libraryRevision } });
  expect(imported.status()).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: 'Planejar meu dia', exact: true }).click();
  const proposal = page.getByRole('region', { name: 'Revisar proposta do JARVIS' });
  await expect(proposal).toContainText('Rever candidatura');
  await expect(proposal).toContainText('Conferir orçamento');
  await expect(proposal).not.toContainText('Etapa já concluída');
  await expect(page.locator('.message-assistant').last()).toContainText('Eu começaria por');
  const before = await (await page.request.get('/api/personal/data')).json();
  expect(before.projects).toEqual(initial.projects);
  await page.getByRole('button', { name: 'Confirmar proposta', exact: true }).click();
  await expect(proposal).toHaveCount(0);
  let saved = await (await page.request.get('/api/personal/data')).json();
  const daily = saved.projects.find((project: { title: string }) => project.title === 'Plano diário');
  expect(daily.tasks.map((task: { title: string }) => task.title)).toEqual(['Rever candidatura', 'Conferir orçamento']);
  const note = saved.library.find((note: { path: string }) => note.path === '04 Planejamento/Tarefas pessoais.md');
  expect((await (await page.request.get(`/api/personal/knowledge/${note.id}`)).json()).content).toBe(content);
  await page.getByRole('button', { name: 'Projetos e tarefas', exact: true }).click();
  const card = page.getByRole('article', { name: 'Projeto Plano diário', exact: true });
  await card.getByRole('button', { name: 'Concluir tarefa: Rever candidatura', exact: true }).click();
  await card.getByRole('button', { name: 'Concluir tarefa: Conferir orçamento', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  await page.getByRole('button', { name: 'Planejar meu dia', exact: true }).click();
  await expect(page.locator('.message-assistant').last()).toContainText('Qual objetivo');
  await expect(proposal).toHaveCount(0);
  saved = await (await page.request.get('/api/personal/data')).json();
  expect(saved.projects.find((project: { id: string }) => project.id === daily.id).tasks).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
