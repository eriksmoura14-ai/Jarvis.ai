import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { validatedPlan } from '../interpretation.js';
import { markdownTitle, retrieveKnowledge, knowledgeFollowupSubject } from './knowledge-index.js';
import { MAX_KNOWLEDGE_NOTES, MAX_LIBRARY_BYTES, validKnowledgeSources, type KnowledgeNote } from '../../shared/knowledge.js';
import { PersonalStore, SQLiteDocument } from './store.js';
import { NoteStore } from '../database.js';
const apps: FastifyInstance[] = []; const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(apps.splice(0).map(app => app.close())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const password = 'fixture-knowledge-password-123';
const file = { path: 'Estudos/React.md', content: '---\ntags: [estudo]\n---\n# React\n\n## Efeitos\nuseEffect sincroniza o componente com sistemas externos. [[Estado|Estado local]] é outra nota.' };
const ai = { provider: 'groq' as const, model: 'fixture-model', apiKey: 'fixture-knowledge-key' };
async function setup(extra: Parameters<typeof buildApp>[0] = {}) {
  const app = await buildApp({ databasePath: ':memory:', personal: { password, secure: false }, ...extra }); apps.push(app);
  const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password } });
  const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
  const data = async () => (await app.inject({ url: '/api/personal/data', headers })).json();
  const read = (id: string) => app.inject({ url: `/api/personal/knowledge/${id}`, headers });
  const importFiles = async (files = [file], replace = false, revision?: number) => app.inject({ method: 'POST', url: '/api/personal/knowledge/import', headers, payload: { files, replace, libraryRevision: revision ?? (await data()).libraryRevision } });
  const remove = async (id: string, revision?: number) => app.inject({ method: 'DELETE', url: `/api/personal/knowledge/${id}`, headers, payload: { libraryRevision: revision ?? (await data()).libraryRevision } });
  const chat = (message: string, extra = {}) => app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message, timeZone: 'America/Sao_Paulo', sessionId: randomUUID(), ...extra } });
  return { app, headers, data, read, importFiles, remove, chat };
}
describe('biblioteca Markdown pessoal', () => {
  it('protege importação/leitura, recusa arquivos inválidos, repetidos e lotes grandes', async () => {
    const { app, headers, importFiles, data } = await setup();
    const payload = { files: [file], replace: false, libraryRevision: 0 };
    expect((await app.inject({ method: 'POST', url: '/api/personal/knowledge/import', payload, headers: { 'x-jarvis-client': '1' } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/personal/knowledge/search?q=React' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/personal/knowledge/import', payload, headers: { cookie: headers.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/personal/knowledge/import', payload, headers: { ...headers, origin: 'https://other.example' } })).statusCode).toBe(403);
    for (const path of ['../React.md', '/React.md', '.obsidian/config.md', 'Estudos\\React.md', 'https://example.com/a.md', 'imagem.png']) expect((await importFiles([{ ...file, path }])).statusCode).toBe(400);
    expect((await importFiles([{ ...file, content: 'a\0b' }])).statusCode).toBe(400);
    expect((await importFiles([{ ...file, content: 'á'.repeat(25_001) }])).statusCode).toBe(400);
    expect((await importFiles([file, { ...file, path: 'ESTUDOS/react.md' }])).statusCode).toBe(400);
    expect((await importFiles(Array.from({ length: 21 }, (_, index) => ({ ...file, path: `${index}.md` })))).statusCode).toBe(400);
    expect((await importFiles([file])).statusCode).toBe(429);
    expect((await data()).library).toEqual([]);
  });
  it('recusa um lote que excede 250 KB mesmo com arquivos individualmente válidos', async () => {
    const { importFiles, data } = await setup();
    expect((await importFiles(Array.from({ length: 6 }, (_, index) => ({ path: `${index}.md`, content: 'a'.repeat(50_000) })))).statusCode).toBe(400);
    expect((await data()).library).toEqual([]);
  });
  it('persiste cópias, exige revisão para atualizar e não salva parcialmente um lote conflitante', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-knowledge-')); dirs.push(dir); const databasePath = join(dir, 'data.sqlite');
    const first = await setup({ databasePath }); await first.chat('meu nome é Erik'); await first.chat('anotar ideia antiga');
    expect((await first.importFiles()).json()).toMatchObject({ added: 1, updated: 0 });
    const original = await first.data(); const id = original.library[0].id;
    expect(original.library[0]).toMatchObject({ title: 'React', revision: 1 }); expect(original.library[0].content).toBeUndefined();
    expect((await first.read(id)).json().content).toBe(file.content);
    expect((await first.importFiles()).json()).toMatchObject({ unchanged: 1 }); expect((await first.data()).generation).toBe(original.generation);
    const changed = { ...file, content: '# React\nInformação atualizada.' };
    expect((await first.importFiles([{ path: 'Nova.md', content: '# Nova' }, changed])).statusCode).toBe(409);
    expect((await first.data()).library).toHaveLength(1);
    expect((await first.importFiles([changed], true)).statusCode).toBe(200);
    expect((await first.importFiles([{ path: 'Antiga.md', content: '# Antiga' }], false, original.libraryRevision)).statusCode).toBe(409);
    await first.app.close(); apps.splice(apps.indexOf(first.app), 1);
    const second = await setup({ databasePath }); const current = await second.data();
    expect(current.library[0]).toMatchObject({ id, revision: 2 }); expect((await second.read(id)).json().content).toBe(changed.content);
    expect(current.notes[0].content).toBe('ideia antiga'); expect(current.memories[0].content).toContain('Erik');
    expect((await second.remove(id, original.libraryRevision)).statusCode).toBe(409); expect((await second.remove(id)).statusCode).toBe(200);
    expect((await second.read(id)).statusCode).toBe(404);
  });
  it.each(['count', 'bytes'])('mantém a biblioteca intacta ao exceder o limite de %s', async limit => {
    const db = new NoteStore(':memory:'); const backend = new SQLiteDocument(db); const store = new PersonalStore(backend);
    try {
      const batches = limit === 'count' ? MAX_KNOWLEDGE_NOTES / 20 : MAX_LIBRARY_BYTES / 250_000;
      for (let batch = 0; batch < batches; batch++) {
        const files = Array.from({ length: limit === 'count' ? 20 : 5 }, (_, index) => ({ path: `${batch}-${index}.md`, content: limit === 'count' ? '# Nota' : 'a'.repeat(50_000) }));
        await store.importKnowledge(files, batch, false);
      }
      const { importFiles, data, app } = await setup({ personalBackend: backend });
      const before = await data();
      expect((await importFiles([{ path: 'Extra.md', content: '# Extra' }])).statusCode).toBe(409);
      expect((await data()).library).toEqual(before.library); expect((await data()).libraryRevision).toBe(before.libraryRevision);
      await app.close(); apps.splice(apps.indexOf(app), 1);
    } finally { db.close(); }
  });
  it('consulta real sem IA fornece fontes locais e preserva referências no histórico', async () => {
    const { importFiles, chat, data, remove } = await setup(); await importFiles();
    const response = (await chat('O que eu já estudei sobre React no meu Obsidian?', { webSearch: true, stream: true })).body;
    const result = response.trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'result').response;
    expect(result.provider).toBe('local'); expect(result.message).toContain('useEffect'); expect(validKnowledgeSources(result.knowledgeSources)).toBe(true); expect(result.webSearch).toBeUndefined();
    const snapshot = await data(); expect(snapshot.history.at(-1).knowledgeSources[0].id).toBe(snapshot.library[0].id);
    const followup = (await chat('Explique mais detalhes disso.', { webSearch: true })).json();
    expect(followup.command).toBe('knowledge'); expect(followup.message).toContain('useEffect'); expect(followup.webSearch).toBeUndefined();
    await remove(snapshot.library[0].id); expect((await data()).history.at(-1).knowledgeSources).toEqual([]);
    expect((await chat('O que eu já estudei sobre React no meu Obsidian?')).json().message).toContain('Ainda não há notas');
  });
  it('envia trechos reais ao modelo sem pesquisa pública e continua o assunto privado', async () => {
    const prompts: { messages: { content: string }[]; tools: { function: { name: string } }[] }[] = [];
    const searchFetch = vi.fn<typeof fetch>();
    const modelFetch: typeof fetch = async (_url, init) => { prompts.push(JSON.parse(String(init?.body))); return Response.json({ choices: [{ message: { content: 'Você anotou que useEffect sincroniza com sistemas externos [N1]. Uma referência inventada [N99].' } }] }); };
    const { chat, importFiles, app, headers, data } = await setup({ ai, modelFetch, searchFetch }); await importFiles();
    const first = (await chat('O que eu já estudei sobre React no meu Obsidian?', { webSearch: true })).json();
    expect(first.knowledgeSources[0]).toMatchObject({ path: file.path, id: (await data()).library[0].id }); expect(first.message).not.toContain('[N99]');
    expect(prompts[0].messages.at(-2)?.content).toContain('useEffect sincroniza'); expect(prompts[0].tools.map(tool => tool.function.name)).not.toContain('search_web');
    const second = (await chat('E como isso ajuda meu projeto?', { webSearch: true })).json(); expect(second.knowledgeSources.length).toBeGreaterThan(0);
    const third = (await chat('Explique mais detalhes disso.', { webSearch: true })).json(); expect(third.knowledgeSources.length).toBeGreaterThan(0);
    expect(prompts.at(-1)!.tools.map(tool => tool.function.name)).not.toContain('search_web');
    expect(searchFetch).not.toHaveBeenCalled();
    expect((await chat('Oi', { knowledgeContext: [{ path: 'injetado.md' }] })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/personal/knowledge/search?q=assuntoausente', headers })).json().sources).toEqual([]);
    const context = [{ role: 'user', content: 'React no meu Obsidian' }, { role: 'assistant', content: 'Um trecho.' }, { role: 'user', content: 'Mais detalhes sobre isso.' }];
    expect(knowledgeFollowupSubject(context, 'Continue nisso.')).toBe('React no meu Obsidian');
    expect(knowledgeFollowupSubject([...context, { role: 'user', content: 'Pesquise sobre a Ucrânia' }], 'Continue nisso.')).toBe('');
  });
  it('bloqueia termos privados até de notas não recuperadas no planejamento público', async () => {
    const searchFetch = vi.fn<typeof fetch>(); const modelFetch: typeof fetch = async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'search_web', arguments: JSON.stringify({ queries: ['IA SegredoInedito'], news: true }) } }] }, finish_reason: 'tool_calls' }] });
    const { importFiles, chat } = await setup({ ai, modelFetch, searchFetch });
    await importFiles([{ path: 'Pessoal.md', content: '# Pessoal\nSegredoInedito.' }]);
    expect((await chat('Tem novidades de IA?')).json().message).toContain('assunto público'); expect(searchFetch).not.toHaveBeenCalled();
    expect(validatedPlan({ queries: ['IA SegredoInedito'], news: true }, { message: 'IA hoje', sessionId: randomUUID(), timeZone: 'UTC', privateKnowledgeTerms: 'SegredoInedito' })).toBeUndefined();
  });
  it('descarta uma resposta em andamento após atualizar a nota consultada', async () => {
    let finish!: (response: Response) => void; let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    const { importFiles, chat, data } = await setup({ ai, modelFetch: async () => { enter(); return new Promise(resolve => { finish = resolve; }); } }); await importFiles();
    const pending = chat('Explique meu Obsidian sobre React').then(response => response); await entered;
    await importFiles([{ ...file, content: '# React\nConteúdo novo.' }], true);
    finish(Response.json({ choices: [{ message: { content: 'Resposta antiga da nota [N1].' } }] }));
    expect((await pending).statusCode).toBe(409); expect((await data()).history.some((entry: { content: string }) => entry.content.includes('Resposta antiga'))).toBe(false);
  });
  it('localiza uma seção distante, interpreta wikilinks e não consulta anexos ou URLs', () => {
    const note: KnowledgeNote = { id: randomUUID(), path: 'Estudos/React.md', title: 'React', bytes: 30_000, revision: 1, updatedAt: new Date().toISOString(), content: '# React\n' + 'Introdução longa. '.repeat(1000) + '\n## Efeitos\nuseEffect sincroniza sistemas externos. [[Estado|Estado local]] ![[foto.png]] [site](https://example.com)' };
    const found = retrieveKnowledge([note], 'Me explique useEffect nas minhas notas do Obsidian');
    expect(found[0].heading).toBe('Efeitos'); expect(found[0].excerpt).toContain('Estado local'); expect(found[0].excerpt).not.toContain('https://'); expect(found[0].excerpt).not.toContain('foto.png');
    expect(validKnowledgeSources(found)).toBe(true);
    expect(markdownTitle({ path: 'Fallback.md', content: '---\ntitle: Outra\n---\n```md\n# Falso\n```\nTexto comum' })).toBe('Fallback');
  });
});
