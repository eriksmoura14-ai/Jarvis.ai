import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { resolveConversation } from '../conversation.js';
import { automaticSearchQuery } from '../../shared/search.js';
import { routingCases } from './routing-cases.js';
import { retrieveKnowledge } from '../personal/knowledge-index.js';
import { recordedGoalsAnswer } from '../personal/goal-summary.js';
import type { ConversationTurn } from '../../shared/contracts.js';
import type { KnowledgeNote } from '../../shared/knowledge.js';
import { NoteStore } from '../database.js';
import { PersonalStore, SQLiteDocument } from '../personal/store.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const note = (title: string, content: string): KnowledgeNote => ({ id: randomUUID(), path: title + '.md', title, content, bytes: Buffer.byteLength(content), revision: 1, updatedAt: '2026-10-12T10:00:00Z' });
const ai = { provider: 'groq' as const, model: 'openai/gpt-oss-20b', apiKey: 'fixture-quality-key' };
const answer = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
async function setup(extra: Parameters<typeof buildApp>[0] = {}) {
  const app = await buildApp({ databasePath: ':memory:', ...extra }); apps.push(app);
  const send = (message: string, context: ConversationTurn[] = []) => app.inject({ method: 'POST', url: '/api/chat', payload: { message, context, sessionId: randomUUID(), timeZone: 'America/Sao_Paulo' } });
  return { app, send };
}

describe('regressões dos pedidos reais, sem inferência externa', () => {
  it.each(routingCases)('encaminha $id sem depender do modelo', test => {
    const resolution = resolveConversation(test.context ?? [], test.message, test.fromKnowledge);
    const search = !resolution.clarification && !resolution.privateOnly && !!(resolution.publicQuery ?? automaticSearchQuery(test.message));
    expect(!!search).toBe(test.expected.search);
    if (test.expected.clarification !== undefined) expect(!!resolution.clarification).toBe(test.expected.clarification);
    if (test.expected.personal !== undefined) expect(resolution.privateOnly).toBe(test.expected.personal);
    if (test.expected.subject) expect(resolution.subject?.toLowerCase()).toContain(test.expected.subject);
  });
  it('um pedido sem assunto não pesquisa bares ou animais nem gasta uma chamada', async () => {
    const modelFetch = vi.fn<typeof fetch>(); const searchFetch = vi.fn<typeof fetch>();
    const { send } = await setup({ ai, modelFetch, searchFetch });
    for (const message of ['pode pesquisar para mim', 'pesquise', 'pesquise sobre isso', 'sim']) {
      const response = await send(message);
      expect(response.statusCode).toBe(200); expect(response.json().provider).toBe('local');
      expect(response.json().sources).toBeUndefined(); expect(response.json().webSearch).toBeUndefined();
      expect(response.json().message).not.toMatch(/bares|Jonathan|Roblox/i);
    }
    expect(modelFetch).not.toHaveBeenCalled(); expect(searchFetch).not.toHaveBeenCalled();
  });
  it('a busca lexical por “sim” não recupera uma confirmação da nota Roblox', () => {
    const notes = [note('Canal Roblox', '# Canal Roblox\nConfirmar se ainda quer manter o projeto. Se sim, definir público e formato.'), note('Modelo de contato', '# Modelo de contato\nSite localizado? Sim / não localizado / incerto.')];
    expect(retrieveKnowledge(notes, 'sim')).toEqual([]);
  });
  it.each(['anotar SegredoPessoal', 'lembre que SegredoPessoal', 'salve SegredoPessoal'])('não transforma a ação privada anterior em consulta: %s', action => {
    const context: ConversationTurn[] = [{ role: 'user', content: action }, { role: 'assistant', content: 'Informação registrada.' }];
    const result = resolveConversation(context, 'pode pesquisar para mim');
    expect(result.publicQuery).toBeUndefined(); expect(result.privateOnly).toBe(true); expect(result.clarification).toContain('qual assunto');
    expect(automaticSearchQuery(action + ' preço hoje')).toBeUndefined();
    expect(resolveConversation(context, 'E o que mudou nisso hoje?').clarification).toContain('Qual tema público');
  });
  it.each([false, true])('consulta o calendário oficial e mantém OBMEP ao aceitar a oferta anterior, aceitação=%s', async acceptance => {
    const year = new Date().getFullYear();
    // Synthetic source data: this test validates transport/routing, not the real exam date.
    const title = `OBMEP ${year} calendário da segunda fase`;
    const rss = `<rss><channel><item><title>${title}</title><link>https://www.obmep.org.br/calendario.htm</link><description>Calendário oficial da segunda fase da OBMEP ${year}.</description></item><item><title>${title}</title><link>https://obmep.org.br.example.com/falso</link><description>Calendário não oficial da segunda fase da OBMEP ${year}.</description></item></channel></rss>`;
    const searchFetch = vi.fn<typeof fetch>(async url => new Response(new URL(String(url)).hostname.includes('bing') ? rss : '<div class="no-results">No results found</div>', { headers: { 'Content-Type': new URL(String(url)).hostname.includes('bing') ? 'application/xml' : 'text/html' } }));
    const modelFetch = vi.fn<typeof fetch>(async () => answer('A fonte oficial encontrada é o calendário da OBMEP [1]. O trecho não contém uma data, então ainda não posso afirmar o dia da prova.'));
    const { send } = await setup({ ai, modelFetch, searchFetch });
    const message = 'quando vai acontecer a segunda fase da obmep?';
    const context: ConversationTurn[] = [{ role: 'user', content: message }, { role: 'assistant', content: 'Não há data registrada nas notas. Se quiser, posso ajudar a verificar fontes externas.' }];
    const response = await send(acceptance ? 'sim' : message, acceptance ? context : []);
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.command).toBe('search'); expect(result.knowledgeSources).toBeUndefined();
    expect(result.sources).toHaveLength(1); expect(result.sources[0].url).toBe('https://www.obmep.org.br/calendario.htm');
    expect(result.webSearch.query).toContain('segunda fase'); expect(result.webSearch.query).toContain('site:obmep.org.br');
    expect(result.message).not.toContain('Roblox'); expect(result.message).toContain('não contém uma data');
    expect(modelFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(modelFetch.mock.calls[0][1]?.body));
    expect(body.messages[0].content).toContain('Data local desta conversa:'); expect(body.messages.at(-1).content).toBe(acceptance ? 'sim' : message);
    expect(body.tools).toBeUndefined();
  });
  it('preserva linhas inteiras, inclusive metas no fim de tabelas grandes, sem promover exemplos de código', () => {
    const rows = Array.from({ length: 13 }, (_, i) => `| Aprender linguagem ${i} | Futuro, ciclo a confirmar | Plano sem conclusão registrada. ${'Detalhe '.repeat(10)} |`).join('\n');
    const content = '# Metas pessoais\n| Meta | Horizonte | Situação |\n|---|---|---|\n' + rows + '\n| Aprender astronomia | Futuro | Plano, não realizado |';
    const sources = retrieveKnowledge([note('Metas pessoais', content)], 'astronomia');
    const result = recordedGoalsAnswer('Quais são meus objetivos?', sources);
    expect(result).toContain('Aprender astronomia'); expect(result).toContain('Plano, não realizado');
    expect(sources.every(source => source.excerpt.length <= 1100)).toBe(true);
    const code = note('Metas pessoais', '# Metas pessoais\n```md\n' + 'Exemplo '.repeat(200) + '\n| Meta | Horizonte | Situação |\n|---|---|---|\n| Ser astronauta | Futuro | Plano |\n```');
    expect(recordedGoalsAnswer('Quais são meus objetivos?', retrieveKnowledge([code], 'astronauta'))).toBeUndefined();
  });
  it('tabelas adjacentes não misturam os campos de situação e horizonte', () => {
    const content = '# Metas pessoais\n| Meta | Horizonte | Situação |\n|---|---|---|\n| Estudar Rust | Futuro | Planejado |\n| Meta | Situação | Horizonte |\n|---|---|---|\n| Documentar API | Sem publicação confirmada | Data a confirmar |';
    const result = recordedGoalsAnswer('Quais são meus objetivos?', retrieveKnowledge([note('Metas pessoais', content)], 'objetivos'));
    expect(result).toContain('Horizonte registrado: Data a confirmar. Situação registrada: Sem publicação confirmada');
    expect(result).not.toContain('Horizonte registrado: Sem publicação confirmada');
  });
  it('recupera a retificação posterior mesmo sem repetir as palavras da pergunta', () => {
    const content = '# Rumo\n## Metas pessoais\n| Meta | Horizonte | Situação |\n|---|---|---|\n| Aplicativo pessoal | Futuro | Código a localizar |\n## Atualização — 12/10/2026\nA afirmação anterior foi superada: o código foi localizado. A publicação foi confirmada no registro.';
    const sources = retrieveKnowledge([note('Rumo', content)], 'Quais são meus objetivos?');
    expect(sources.some(source => source.heading.startsWith('Atualização') && source.excerpt.includes('foi superada'))).toBe(true);
    // A table-only answer cannot reconcile this change; retain model reasoning
    // with both passages instead of extracting an obsolete status.
    expect(recordedGoalsAnswer('Quais são meus objetivos?', sources)).toBeUndefined();
  });
  it('respeita Retry-After entre perguntas sem novas chamadas, mantém comandos e retoma após o prazo', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const initial = Date.now();
    try {
      const modelFetch = vi.fn<typeof fetch>().mockImplementationOnce(async () => Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429, headers: { 'Retry-After': '120' } }))
        .mockImplementation(async () => answer('Componentes organizam a interface.'));
      const { send } = await setup({ ai, modelFetch });
      expect((await send('Explique React')).statusCode).toBe(429);
      expect((await send('Explique TypeScript')).statusCode).toBe(429);
      expect((await send('calcular 2 + 3')).json().message).toBe('O resultado é 5.');
      clock.mockReturnValue(initial + 119_000);
      expect((await send('Explique componentes')).statusCode).toBe(429);
      expect(modelFetch).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(initial + 121_000);
      expect((await send('Explique componentes')).statusCode).toBe(200);
      expect(modelFetch).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });
  it('continua a oferta antiga na conta autenticada, sem enviar o cofre nem confirmar Roblox', async () => {
    const db = new NoteStore(':memory:'); const backend = new SQLiteDocument(db); const store = new PersonalStore(backend);
    let app: FastifyInstance | undefined;
    try {
      await store.importKnowledge([{ path: 'OBMEP.md', content: '# OBMEP\nData a confirmar. SegredoDoCofre.' }, { path: 'Roblox.md', content: '# Canal Roblox\nSe sim, confirmar se quer manter o projeto.' }], 0, false);
      const record = await store.snapshotRecord(); const topic = 'quando vai acontecer a segunda fase da obmep?';
      const sources = retrieveKnowledge(record.knowledge, 'OBMEP');
      const createdAt = new Date().toISOString();
      await store.append([{ id: randomUUID(), role: 'user', content: topic, createdAt }, { id: randomUUID(), role: 'assistant', content: 'Não há data registrada. Se quiser, posso ajudar a verificar fontes externas.', createdAt, knowledgeSources: sources }], record.snapshot.generation);
      expect((await store.snapshotRecord()).lastAnswerFromKnowledge).toBe(true);
      const year = new Date().getFullYear();
      const searchFetch = vi.fn<typeof fetch>(async url => new Response(new URL(String(url)).hostname.includes('bing') ? `<rss><channel><item><title>OBMEP ${year} calendário da segunda fase</title><link>https://www.obmep.org.br/calendario.htm</link><description>Confira o calendário da segunda fase da OBMEP ${year}.</description></item></channel></rss>` : '<div class="no-results">No results found</div>', { headers: { 'Content-Type': new URL(String(url)).hostname.includes('bing') ? 'application/xml' : 'text/html' } }));
      const modelFetch = vi.fn<typeof fetch>(async () => answer('Encontrei o calendário oficial da segunda fase da OBMEP [1]. O trecho ainda não informa a data.'));
      const password = 'fixture-quality-personal-password';
      app = await buildApp({ databasePath: ':memory:', personalBackend: backend, personal: { password, secure: false }, ai, modelFetch, searchFetch });
      const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password } });
      const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
      const before = await store.snapshot();
      const response = await app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message: 'sim', sessionId: randomUUID(), timeZone: 'America/Sao_Paulo' } });
      expect(response.statusCode).toBe(200); expect(response.json().command).toBe('search');
      expect(response.json().knowledgeSources).toBeUndefined(); expect(response.json().message).not.toContain('Roblox');
      expect(modelFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(modelFetch.mock.calls[0][1]?.body));
      expect(JSON.stringify(body.messages)).not.toMatch(/SegredoDoCofre|Canal Roblox|Não há data registrada/);
      expect(body.messages.at(-1).content).toBe('sim');
      const after = await store.snapshot(); expect(after.library).toEqual(before.library); expect(after.memories).toEqual(before.memories); expect(after.projects).toEqual(before.projects);
      expect(after.history.at(-2)?.content).toBe('sim'); expect(after.history.at(-1)?.content).toBe(response.json().message);
    } finally { await app?.close(); db.close(); }
  });
});
