import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { dailyPlan } from './daily-plan.js';
import { validKnowledgeSources, type KnowledgeNote } from '../../shared/knowledge.js';
import type { PersonalSnapshot } from '../../shared/contracts.js';
import type { PersonalProject } from '../../shared/projects.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const now = new Date('2026-10-12T01:00:00Z'); // Still October 11 in Brazil.
const request = { message: 'Planeje meu dia', sessionId: randomUUID(), timeZone: 'America/Sao_Paulo' };
const snapshot: PersonalSnapshot = { history: [], memories: [], notes: [], generation: 0, storage: 'sqlite', projects: [], projectsRevision: 0 };
const note = (title: string, content: string): KnowledgeNote => ({ id: randomUUID(), revision: 1, path: `04 Planejamento/${title}.md`, title, content, bytes: Buffer.byteLength(content), updatedAt: now.toISOString() });
const goalContent = '# Metas e cronograma\n\n| Meta | Horizonte | Situação |\n|---|---|---|\n| Estudar no exterior | 2027 a confirmar | Plano sem resultado confirmado |\n| Inglês C1 | Gradual | Meta |\n| Medalha futura | 2027 | Cancelada |\n| Curso antigo | 2025 | Concluído |';
const project = (title: string, tasks: { title: string; dueDate?: string; status?: 'pending' | 'done' }[], archived = false): PersonalProject => ({
  id: randomUUID(), title, description: '', archived, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  tasks: tasks.map(task => ({ ...task, id: randomUUID(), status: task.status ?? 'pending', createdAt: now.toISOString() })),
});

describe('planejamento fundamentado nas notas e tarefas', () => {
  it('prioriza prazos reais no fuso do aparelho e exclui concluídas/arquivadas sem criar cópias', () => {
    const projects = [project('Estudos', [{ title: 'Mais tarde', dueDate: '2026-10-13' }, { title: 'Hoje', dueDate: '2026-10-11' }, { title: 'Atrasada', dueDate: '2026-10-10' }, { title: 'Já concluída', status: 'done' }]), project('Arquivado', [{ title: 'Não sugerir', dueDate: '2026-10-09' }], true)];
    const plan = dailyPlan(request, { ...snapshot, projects }, [note('Metas e cronograma', goalContent)], now)!;
    expect(plan.reply.message.indexOf('Atrasada')).toBeLessThan(plan.reply.message.indexOf('Hoje'));
    expect(plan.reply.message).toContain('“Hoje”, do projeto “Estudos” (hoje)');
    expect(plan.reply.message).not.toContain('Já concluída'); expect(plan.reply.message).not.toContain('Não sugerir');
    expect(plan.reply.projectChange).toBeUndefined(); expect(plan.sources).toEqual([]);
  });
  it('usa checklists pendentes antes de metas e identifica sugestões sem inventar datas ou conquistas', () => {
    const notes = [note('Metas e cronograma', goalContent), note('Tarefas', '# Tarefas\n- [x] Concluído\n- [ ] Revisar candidatura\n```md\n- [ ] Exemplo fictício\n```')];
    const plan = dailyPlan(request, snapshot, notes, now)!;
    expect(plan.reply.message).toContain('começaria por revisar candidatura [N1]');
    expect(plan.reply.message).toContain('sugestão baseada nas suas notas');
    expect(plan.reply.message).not.toContain('Medalha futura'); expect(plan.reply.message).not.toContain('Curso antigo'); expect(plan.reply.message).not.toContain('Exemplo fictício');
    expect(plan.reply.projectChange).toMatchObject({ action: 'create_project', title: 'Plano diário', tasks: [{ title: 'Revisar candidatura' }, { title: 'Definir o próximo passo para: Estudar no exterior' }, { title: 'Definir o próximo passo para: Inglês C1' }] });
    expect(plan.sources).toHaveLength(3); expect(validKnowledgeSources(plan.sources)).toBe(true);
    expect(JSON.stringify(plan.reply.projectChange)).not.toContain('dueDate');
    expect(plan.sources[1].excerpt).toContain('Plano sem resultado confirmado'); expect(snapshot.projects).toEqual([]);
  });
  it('prioriza ações e metas acima de atualizar o contexto, sem inventar urgência para obrigações', () => {
    const notes = [note('00 Pendências', '# Pendências\n- [ ] Preencher Perguntas para atualizar meu contexto.\n- [ ] Atualizar a etapa real de Faculdade no exterior e Educacao e documentos.\n- [ ] Conferir a convocação atual em Alistamento militar.'), note('Metas e cronograma', goalContent)];
    const before = structuredClone(notes);
    const plan = dailyPlan(request, snapshot, notes, now)!;
    expect(plan.reply.projectChange).toMatchObject({ tasks: [{ title: 'Conferir a convocação atual em Alistamento militar.' }, { title: 'Definir o próximo passo para: Estudar no exterior' }, { title: 'Definir o próximo passo para: Inglês C1' }] });
    expect(plan.reply.message).toContain('começaria por conferir a convocação atual em Alistamento militar [N1].');
    expect(plan.reply.message).toContain('definir um próximo passo para Estudar no exterior [N2]');
    expect(plan.reply.message).not.toMatch(/etapa real|meu contexto|urgente|prazo registrado/);
    expect(notes).toEqual(before); expect(JSON.stringify(plan.reply.projectChange)).not.toContain('dueDate');
    expect(validKnowledgeSources(plan.sources)).toBe(true);
  });
  it('mantém pendências de contexto já salvas, mas prioriza ações reais; um prazo explícito é respeitado', () => {
    const housekeeping = project('Plano diário', [{ title: 'Preencher Perguntas para atualizar meu contexto.' }, { title: 'Atualizar a etapa real de Faculdade no exterior.' }]);
    const projects = [housekeeping]; const before = structuredClone(projects);
    const notes = [note('Tarefas', '# Tarefas\n- [ ] Atualizar o site do cliente\n- [ ] Praticar perguntas de inglês'), note('Metas e cronograma', goalContent)];
    const plan = dailyPlan(request, { ...snapshot, projects }, notes, now)!;
    expect(plan.reply.message).toContain('começaria por atualizar o site do cliente [N1]');
    expect(plan.reply.message).not.toContain('meu contexto');
    expect(plan.reply.projectChange).toMatchObject({ action: 'add_tasks', projectId: housekeeping.id, tasks: [{ title: 'Atualizar o site do cliente' }, { title: 'Praticar perguntas de inglês' }, { title: 'Definir o próximo passo para: Estudar no exterior' }] });
    expect(projects).toEqual(before);
    const due = project('Contexto', [{ title: 'Atualizar meu contexto', dueDate: '2026-10-11' }]);
    const withDeadline = dailyPlan(request, { ...snapshot, projects: [due] }, notes, now)!;
    expect(withDeadline.reply.message).toContain('começaria por “Atualizar meu contexto”, do projeto “Contexto” (hoje)');
    expect(withDeadline.reply.message).toContain('prazo registrado');
    expect(withDeadline.sources).toHaveLength(2);
  });
  it('não descarta a manutenção quando é o único passo disponível nem deixa muitos checklists bloquearem metas', () => {
    const content = '# Pendências\n- [ ] Preencher Perguntas para atualizar meu contexto.';
    const fallback = dailyPlan(request, snapshot, [note('Contexto', content)], now)!;
    expect(fallback.reply.projectChange).toMatchObject({ tasks: [{ title: 'Preencher Perguntas para atualizar meu contexto.' }] });
    expect(fallback.reply.message).not.toContain('prazo registrado');
    const many = Array.from({ length: 100 }, (_, i) => `- [ ] Atualizar a etapa real do contexto ${i}`).join('\n');
    const plan = dailyPlan(request, snapshot, [note('00 Pendências', '# Pendências\n' + many), note('Metas e cronograma', goalContent)], now)!;
    expect(plan.sources[0].title).toBe('Metas e cronograma');
    expect(plan.sources[1].title).toBe('Metas e cronograma');
    expect(plan.sources[2].title).toBe('00 Pendências');
    expect(plan.reply.projectChange).toMatchObject({ tasks: [{ title: 'Definir o próximo passo para: Estudar no exterior' }, { title: 'Definir o próximo passo para: Inglês C1' }, { title: 'Atualizar a etapa real do contexto 0' }] });
  });
  it('não usa metas públicas, prosa vaga, tarefas concluídas ou reabre um plano arquivado', () => {
    const publicNote = note('Metas do país', '# Metas do país\n| Meta | Situação |\n|---|---|\n| Crescer PIB | Meta |');
    const projects = [project('Plano diário', [{ title: 'Definir o próximo passo para: Inglês C1', status: 'done' }], true)];
    const plan = dailyPlan(request, { ...snapshot, projects }, [publicNote, note('Metas e cronograma', goalContent)], now)!;
    expect(plan.reply.message).not.toContain('Crescer PIB'); expect(plan.reply.message).not.toContain('Inglês C1');
    expect(plan.reply.projectChange?.action).toBe('create_project');
    const empty = dailyPlan(request, snapshot, [note('Reflexão', '# Reflexão\nTalvez eu faça muitas coisas este ano.')], now)!;
    expect(empty.reply.projectChange).toBeUndefined(); expect(empty.reply.message).toContain('Qual objetivo');
  });
  it('reutiliza Plano diário e respeita os limites de persistência sem duplicar etapas', () => {
    const existing = project('Plano diário', [{ title: 'Revisar candidatura', status: 'done' }]);
    const plan = dailyPlan(request, { ...snapshot, projects: [existing] }, [note('Tarefas', '# Tarefas\n- [ ] Revisar candidatura\n- [ ] Rever orçamento')], now)!;
    expect(plan.reply.projectChange).toEqual({ action: 'add_tasks', projectId: existing.id, tasks: [{ title: 'Rever orçamento' }] });
    const full = Array.from({ length: 20 }, (_, i) => project(`Projeto ${i}`, [], true));
    expect(dailyPlan(request, { ...snapshot, projects: full }, [note('Tarefas', '- [ ] Rever orçamento')], now)!.reply.projectChange).toBeUndefined();
  });
  it('planeja e confirma pela API real, preserva notas e rejeita proposta após edição da fonte', async () => {
    const modelFetch = vi.fn<typeof fetch>(); const searchFetch = vi.fn<typeof fetch>();
    const app = await buildApp({ databasePath: ':memory:', personal: { password: 'fixture-daily-password-123', secure: false }, ai: { provider: 'groq', model: 'fixture-model', apiKey: 'fixture-key' }, modelFetch, searchFetch }); apps.push(app);
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password: 'fixture-daily-password-123' } });
    const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
    const data = async () => (await app.inject({ url: '/api/personal/data', headers })).json();
    const file = { path: '04 Planejamento/Metas e cronograma.md', content: goalContent };
    const importFile = async (content = goalContent, replace = false) => app.inject({ method: 'POST', url: '/api/personal/knowledge/import', headers, payload: { files: [{ ...file, content }], replace, libraryRevision: (await data()).libraryRevision } });
    expect((await importFile()).statusCode).toBe(200);
    const chat = async () => app.inject({ method: 'POST', url: '/api/chat', headers, payload: { ...request, stream: true } });
    const answer = await chat();
    const event = answer.body.trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'result');
    expect(event.response.message).toContain('[N1]'); expect(event.response.message).not.toMatch(/^\s*[-•*]\s/m);
    expect(event.response.proposal.change.tasks).toHaveLength(2); expect((await data()).projects).toEqual([]);
    expect(modelFetch).not.toHaveBeenCalled(); expect(searchFetch).not.toHaveBeenCalled();
    const confirm = (proposal: unknown) => app.inject({ method: 'POST', url: '/api/personal/projects/confirm', headers, payload: { proposal } });
    expect((await confirm(event.response.proposal)).statusCode).toBe(200);
    expect((await confirm(event.response.proposal)).json().alreadyApplied).toBe(true);
    let saved = await data(); expect(saved.projects).toHaveLength(1); expect(saved.projects[0].tasks).toHaveLength(2); expect(saved.library).toHaveLength(1);
    const planAgain = await chat(); expect(planAgain.body).not.toContain('"proposal"');
    await app.inject({ method: 'POST', url: '/api/personal/projects/change', headers, payload: { change: { action: 'archive_project', projectId: saved.projects[0].id }, projectsRevision: saved.projectsRevision } });
    // A new checkbox yields a reviewable proposal, then editing its source
    // invalidates that proposal through the existing generation guard.
    await importFile(goalContent + '\n\n## Tarefas\n- [ ] Revisar candidatura', true);
    const next = await chat(); const nextResult = next.body.trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'result');
    await importFile(goalContent + '\n\n## Tarefas\n- [ ] Outra prioridade', true);
    expect((await confirm(nextResult.response.proposal)).statusCode).toBe(409);
    saved = await data(); expect(saved.projects).toHaveLength(1); expect(saved.projects[0].tasks).toHaveLength(2);
  });
});
