import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { validatedProjectChange, selectedProjects, validatedPlan } from '../interpretation.js';
import { validDate, priorities, localDay, type PersonalProject } from '../../shared/projects.js';
const apps: FastifyInstance[] = []; const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(apps.splice(0).map(app => app.close())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const password = 'fixture-project-password-123';
const plan = { action: 'create_project' as const, title: 'Inglês', description: 'Aprender durante três meses', tasks: [{ title: 'Estudar vocabulário', dueDate: '2026-10-12' }, { title: 'Praticar conversação' }] };
const tool = (change: unknown) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'propose_project_change', arguments: JSON.stringify(change) } }] }, finish_reason: 'tool_calls' }] });
async function setup(extra: Parameters<typeof buildApp>[0] = {}) {
  const app = await buildApp({ databasePath: ':memory:', personal: { password, secure: false }, ...extra }); apps.push(app);
  const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password } });
  const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
  const data = async () => (await app.inject({ url: '/api/personal/data', headers })).json();
  const chat = (message: string, extra = {}) => app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message, sessionId: randomUUID(), timeZone: 'America/Sao_Paulo', ...extra } });
  const change = async (change: unknown, revision?: number) => app.inject({ method: 'POST', url: '/api/personal/projects/change', headers, payload: { change, projectsRevision: revision ?? (await data()).projectsRevision } });
  const confirm = (proposal: unknown) => app.inject({ method: 'POST', url: '/api/personal/projects/confirm', headers, payload: { proposal } });
  return { app, headers, data, chat, change, confirm };
}
const ai = { provider: 'groq' as const, model: 'openai/gpt-oss-20b', apiKey: 'fixture-project-key' };
describe('projetos e propostas pessoais', () => {
  it('exige conta, proteção de origem e dados válidos para escrever', async () => {
    const { app, headers, change } = await setup();
    const payload = { change: plan, projectsRevision: 0 };
    expect((await app.inject({ method: 'POST', url: '/api/personal/projects/change', headers: { 'x-jarvis-client': '1' }, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/personal/projects/change', headers: { cookie: headers.cookie }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/personal/projects/change', headers: { ...headers, origin: 'https://other.example.com' }, payload })).statusCode).toBe(403);
    expect((await change({ ...plan, tasks: [{ title: 'Algo', dueDate: '2026-02-30' }] })).statusCode).toBe(400);
    expect((await change({ ...plan, execute: 'anything' })).statusCode).toBe(400);
    expect((await change({ ...plan, tasks: Array.from({ length: 21 }, () => ({ title: 'Etapa' })) })).statusCode).toBe(400);
  });
  it('preserva projetos entre reinícios, rejeita edição antiga e mantém notas/memórias', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-projects-')); dirs.push(dir); const databasePath = join(dir, 'data.sqlite');
    const first = await setup({ databasePath });
    await first.chat('meu nome é Erik'); await first.chat('anotar ideia pessoal');
    expect((await first.change(plan)).statusCode).toBe(200);
    let snapshot = await first.data(); const projectId = snapshot.projects[0].id; const taskId = snapshot.projects[0].tasks[0].id;
    expect((await first.change({ action: 'complete_task', projectId, taskId })).statusCode).toBe(200);
    expect((await first.change({ action: 'add_tasks', projectId, tasks: [{ title: 'Outra etapa' }] }, snapshot.projectsRevision)).statusCode).toBe(409);
    expect((await first.change({ action: 'archive_project', projectId })).statusCode).toBe(200);
    expect((await first.chat('minhas tarefas', { webSearch: true })).json().message).toContain('não tem tarefas');
    await first.change({ action: 'restore_project', projectId }); await first.change({ action: 'reopen_task', projectId, taskId });
    await first.app.close(); apps.splice(apps.indexOf(first.app), 1);
    const second = await setup({ databasePath }); snapshot = await second.data();
    expect(snapshot.projects[0].tasks[0].status).toBe('pending'); expect(snapshot.memories[0].content).toContain('Erik'); expect(snapshot.notes[0].content).toBe('ideia pessoal');
    expect((await second.chat('meus projetos', { webSearch: true })).json().provider).toBe('local');
    expect((await second.chat('o que tenho para fazer hoje')).json().message).toContain('Estudar vocabulário');
  });
  it('recusa exceder os limites da conta sem alterar projetos existentes', async () => {
    const { change, data } = await setup();
    for (let index = 0; index < 20; index++) {
      expect((await change({ ...plan, title: `Projeto ${index}`, tasks: index < 10 ? Array.from({ length: 20 }, (_, task) => ({ title: `Etapa ${task}` })) : [] })).statusCode).toBe(200);
    }
    const before = await data();
    expect((await change({ action: 'add_tasks', projectId: before.projects[0].id, tasks: [{ title: 'Excedente' }] })).statusCode).toBe(409);
    expect((await change({ ...plan, title: 'Projeto excedente', tasks: [] })).statusCode).toBe(409);
    const after = await data();
    expect(after.projects).toEqual(before.projects); expect(after.projectsRevision).toBe(before.projectsRevision);
  });
  it('não salva um plano da IA sem confirmação; confirma uma vez, rejeita adulteração e expiração', async () => {
    const searchFetch = vi.fn<typeof fetch>(); const modelFetch = vi.fn<typeof fetch>(async () => tool(plan));
    const { chat, data, confirm } = await setup({ ai, modelFetch, searchFetch });
    const response = (await chat('Crie um projeto para estudar inglês durante três meses', { webSearch: true })).json();
    expect(response.proposal.change).toEqual(plan); expect(response.projectChange).toBeUndefined(); expect((await data()).projects).toEqual([]);
    expect(searchFetch).not.toHaveBeenCalled(); expect(modelFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((await data()).history)).not.toContain(response.proposal.token);
    const changed = structuredClone(response.proposal); changed.change.title = 'Adulterado';
    expect((await confirm(changed)).statusCode).toBe(400);
    expect((await confirm(response.proposal)).json()).toMatchObject({ ok: true, alreadyApplied: false });
    expect((await confirm(response.proposal)).json()).toMatchObject({ ok: true, alreadyApplied: true });
    expect((await data()).projects).toHaveLength(1); expect((await data()).projects[0].tasks).toHaveLength(2);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(response.proposal.expiresAt) + 1);
    expect((await confirm(response.proposal)).statusCode).toBe(409);
  });
  it('recusa proposta antiga após mudanças pessoais e exige IDs atuais para concluir tarefas', async () => {
    let next: unknown = plan;
    const { chat, confirm, change, data } = await setup({ ai, modelFetch: async () => tool(next) });
    const stale = (await chat('Crie um projeto de inglês')).json().proposal;
    await chat('apagar memórias'); expect((await confirm(stale)).statusCode).toBe(409);
    await change(plan); const project = (await data()).projects[0];
    next = { action: 'complete_task', projectId: project.id, taskId: project.tasks[0].id };
    const proposed = (await chat('Concluí a primeira tarefa do meu projeto de inglês')).json();
    expect((await data()).projects[0].tasks[0].status).toBe('pending'); expect((await confirm(proposed.proposal)).statusCode).toBe(200);
    next = { action: 'complete_task', projectId: 'foreign', taskId: 'invented' };
    expect((await chat('Concluí outra tarefa')).json().proposal).toBeUndefined();
    expect((await change({ action: 'complete_task', projectId: 'foreign', taskId: 'invented' })).statusCode).toBe(404);
  });
  it('um stream de proposta incompleto não cria projeto nem confirmação', async () => {
    const fragment = 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'propose_project_change', arguments: '{"action":"create_project"' } }] }, finish_reason: null }] }) + '\n\n';
    const { chat, data } = await setup({ ai, modelFetch: async () => new Response(fragment) });
    const response = await chat('Crie um projeto pessoal', { stream: true });
    expect(response.body).toContain('"type":"error"'); expect(response.body).not.toContain('"type":"result"'); expect((await data()).projects).toEqual([]);
  });
  it.each(['groq', 'ollama'] as const)('recebe proposta %s em stream sem expor argumentos antes da revisão', async provider => {
    const args = JSON.stringify(plan);
    const event = (delta: unknown, finish_reason: string | null = null) => 'data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\n\n';
    const stream = provider === 'groq'
      ? event({ tool_calls: [{ index: 0, function: { name: 'propose_project_change', arguments: args.slice(0, 50) } }] })
        + event({ tool_calls: [{ index: 0, function: { arguments: args.slice(50) } }] }, 'tool_calls') + 'data: [DONE]\n\n'
      : JSON.stringify({ message: { tool_calls: [{ function: { name: 'propose_project_change', arguments: plan } }] }, done: false }) + '\n' + JSON.stringify({ done: true }) + '\n';
    const config = provider === 'groq' ? ai : { provider, model: 'fixture', baseURL: 'http://127.0.0.1:11434' };
    const { chat, data, confirm } = await setup({ ai: config, modelFetch: async () => new Response(stream) });
    const response = await chat('Crie um projeto pessoal de inglês', { stream: true });
    const events = response.body.trim().split('\n').map(line => JSON.parse(line));
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(events.filter(event => event.type === 'text')).toEqual([]);
    const result = events.find(event => event.type === 'result').response;
    expect(result.proposal.change).toEqual(plan); expect((await data()).projects).toEqual([]);
    expect((await confirm(result.proposal)).statusCode).toBe(200); expect((await data()).projects).toHaveLength(1);
  });
  it('invalida uma resposta em andamento quando uma tarefa muda', async () => {
    let finish!: (response: Response) => void; let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const { change, chat, data } = await setup({ ai, modelFetch: async () => { enter(); return new Promise(resolve => { finish = resolve; }); } });
    await change(plan); const project = (await data()).projects[0];
    const pending = chat('Explique meu projeto de inglês').then(response => response); await entered;
    await change({ action: 'complete_task', projectId: project.id, taskId: project.tasks[0].id });
    finish(Response.json({ choices: [{ message: { content: 'A tarefa antiga ainda está pendente.' } }] }));
    expect((await pending).statusCode).toBe(409); expect((await data()).history.some((message: { content: string }) => message.content.includes('tarefa antiga'))).toBe(false);
  });
  it('limita recuperação e impede enviar dados do projeto ao buscador sem assunto público explícito', () => {
    const request = { message: 'Tem novidades de IA?', timeZone: 'UTC', sessionId: randomUUID(), projectData: [], privateProjectTerms: 'ProjetoSegredo' };
    expect(validatedPlan({ queries: ['IA ProjetoSegredo'], news: true }, request)).toBeUndefined();
    expect(validatedProjectChange({ action: 'archive_project', projectId: 'x' }, request)).toBeUndefined();
    const projects: PersonalProject[] = Array.from({ length: 10 }, (_, index) => ({ id: String(index), title: index === 9 ? 'Inglês' : 'Outro', description: '', archived: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', tasks: Array.from({ length: 20 }, (_, task) => ({ id: `${index}-${task}`, title: 'Etapa', status: 'pending', createdAt: '2026-10-01T00:00:00Z' })) }));
    const selected = selectedProjects(projects, 'Meu projeto de inglês');
    expect(selected[0].title).toBe('Inglês'); expect(selected).toHaveLength(5); expect(selected.flatMap(project => project.tasks)).toHaveLength(40);
    projects[9].tasks[0].status = 'done';
    expect(selectedProjects(projects, 'Meu projeto de inglês')[0].tasks[0].status).toBe('done');
    expect(validDate('2026-02-30')).toBe(false); expect(localDay(new Date('2026-10-11T01:00:00Z'), 'America/Sao_Paulo')).toBe('2026-10-10');
    expect(priorities([{ ...projects[0], tasks: [{ ...projects[0].tasks[0], dueDate: '2026-10-09' }] }], '2026-10-10')[0].when).toBe('Atrasada');
  });
});
