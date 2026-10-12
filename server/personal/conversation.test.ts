import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { knowledgeCatalog, readKnowledge } from './knowledge-index.js';
import { validatedKnowledgePlan } from '../interpretation.js';
import { validKnowledgeSources, type KnowledgeNote } from '../../shared/knowledge.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const password = 'fixture-conversation-password';
const ai = { provider: 'groq' as const, model: 'fixture-conversation-model', apiKey: 'fixture-key' };
const text = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
const reading = (noteIds: string[], query = '') => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_notes', arguments: JSON.stringify({ noteIds, query }) } }] }, finish_reason: 'tool_calls' }] });
async function setup(extra: Parameters<typeof buildApp>[0] = {}) {
  const app = await buildApp({ databasePath: ':memory:', personal: { password, secure: false }, ...extra }); apps.push(app);
  const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password } });
  const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
  const data = async () => (await app.inject({ url: '/api/personal/data', headers })).json();
  const chat = (message: string, extra = {}) => app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message, sessionId: randomUUID(), timeZone: 'UTC', ...extra } });
  const importFiles = async (files: { path: string; content: string }[]) => app.inject({ method: 'POST', url: '/api/personal/knowledge/import', headers, payload: { files, replace: false, libraryRevision: (await data()).libraryRevision } });
  return { app, chat, data, headers, importFiles };
}
describe('interpretação com dados pessoais atuais', () => {
  it('consulta metas e mantém o assunto em perguntas sobre prazo e próximo passo sem pesquisar', async () => {
    const prompts: { messages: { content: string }[]; tools?: { function: { name: string } }[] }[] = [];
    const modelFetch = vi.fn<typeof fetch>(async (_url, init) => {
      prompts.push(JSON.parse(String(init?.body)));
      return text('A candidatura está planejada para 2027; a data exata ainda precisa ser confirmada [N1].');
    });
    const searchFetch = vi.fn<typeof fetch>();
    const { chat, importFiles, data, app, headers } = await setup({ ai, modelFetch, searchFetch });
    await importFiles([{ path: 'Metas.md', content: '# Metas pessoais\n## Horizonte\nConseguir uma bolsa para a faculdade. Candidatura em 2027, data exata a confirmar. Não há aprovação registrada.' }]);
    const before = await data();
    for (const message of ['Quais são meus objetivos?', 'E qual o prazo?', 'Por onde começo?']) {
      const result = (await chat(message)).json();
      expect(result.knowledgeSources[0]).toMatchObject({ path: 'Metas.md', excerpt: expect.stringContaining('Não há aprovação registrada') });
      expect(result.webSearch).toBeUndefined();
      expect(prompts.at(-1)?.messages.at(-2)?.content).toContain('data exata a confirmar');
      expect(prompts.at(-1)?.tools?.some(tool => tool.function.name === 'search_web')).toBe(false);
    }
    expect(modelFetch).toHaveBeenCalledTimes(3); expect(searchFetch).not.toHaveBeenCalled();
    expect((await data()).library).toEqual(before.library);
    await app.inject({ method: 'DELETE', url: '/api/personal/history', headers });
    expect((await chat('E qual o prazo?')).json().message).toContain('De qual objetivo');
    expect(modelFetch).toHaveBeenCalledTimes(3);
  });
  it.each([false, true])('extrai objetivos registrados sem nova inferência mesmo após negativa antiga, stream=%s', async stream => {
    const refusal = 'Não tenho detalhes suficientes sobre os seus objetivos futuros. Você pode me dizer quais são ou indicar a nota onde eles estão descritos?';
    const prompts: { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] }[] = [];
    const modelFetch = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); prompts.push(body);
      return body.stream ? new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: refusal }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n') : text(refusal);
    });
    const searchFetch = vi.fn<typeof fetch>();
    const { chat, importFiles, data } = await setup({ ai, modelFetch, searchFetch, aiDailyLimit: 2 });
    await importFiles([{ path: 'Planejamento/Metas.md', content: '# Metas e cronograma\n## Metas registradas e situação conhecida\n| Meta | Horizonte discutido | Situação recuperada |\n|---|---|---|\n| Aprender Rust | Futuro, ciclo a confirmar | Plano, sem curso concluído |\n| Documentar uma API | Futuro, prazo a confirmar | Planejado, sem publicação confirmada |' },
      ...Array.from({ length: 4 }, (_, i) => ({ path: `Projetos/Projeto-${i}.md`, content: `# Projeto ${i}\n## Objetivo futuro\nPreparar uma demonstração ${i}. Ainda é um plano.` }))]);
    await chat('Você já conhece meu planejamento?'); // an older refusal must not override fresh evidence
    const before = await data();
    const response = await chat('quais sao meus futuros objetivos', { webSearch: true, stream, voice: true });
    const result = stream ? response.body.trim().split('\n').map(line => JSON.parse(line)).at(-1).response : response.json();
    expect(result).toMatchObject({ provider: 'local', command: 'knowledge', message: expect.stringContaining('Aprender Rust') });
    expect(result.message).toContain('Plano, sem curso concluído'); expect(result.message).toContain('Documentar uma API');
    expect(result.message).not.toContain('Não tenho detalhes suficientes'); expect(result.message).toContain('não uma confirmação');
    expect(result.knowledgeSources).toHaveLength(1); expect(validKnowledgeSources(result.knowledgeSources)).toBe(true);
    const actual = result.knowledgeSources.find((source: { path: string }) => source.path === 'Planejamento/Metas.md');
    expect(result.message).toContain(`[${actual.reference}]`);
    expect(modelFetch).toHaveBeenCalledTimes(1); expect(searchFetch).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(1); // no inference for extracting the actual table
    const after = await data(); expect(after.library).toEqual(before.library);
    expect(after.history.at(-1).content).toBe(result.message); expect(after.history.at(-1).knowledgeSources).toEqual(result.knowledgeSources);
  });
  it('economiza a leitura e a inferência quando a tabela de metas já foi recuperada', async () => {
    let id = '';
    const modelFetch = vi.fn<typeof fetch>().mockImplementationOnce(async () => reading([id]))
      .mockImplementationOnce(async () => text('Não tenho informações suficientes sobre seus objetivos. Indique uma nota.'));
    const searchFetch = vi.fn<typeof fetch>();
    const { chat, importFiles, data } = await setup({ ai, modelFetch, searchFetch, aiDailyLimit: 2 });
    await importFiles([{ path: 'Direcao.md', content: '# Metas pessoais\n| Meta | Horizonte | Situação |\n|---|---|---|\n| Aprender Rust | Ciclo a confirmar | Plano, sem curso concluído |' }]);
    id = (await data()).library[0].id;
    const result = (await chat('quais sao meus futuros objetivos', { webSearch: true })).json();
    expect(result).toMatchObject({ provider: 'local', command: 'knowledge', message: expect.stringContaining('Aprender Rust'), knowledgeSources: [{ id, path: 'Direcao.md' }] });
    expect(modelFetch).not.toHaveBeenCalled(); expect(searchFetch).not.toHaveBeenCalled();
    expect((await data()).history.at(-1).content).toBe(result.message);
  });
  it('lista títulos reais para o pedido do print e esclarece uma fonte sem assunto', async () => {
    const modelFetch = vi.fn<typeof fetch>(); const searchFetch = vi.fn<typeof fetch>();
    const { chat, importFiles } = await setup({ ai, modelFetch, searchFetch });
    await importFiles([{ path: 'Estudos/React.md', content: '# React\nAprender componentes.' }]);
    expect((await chat('no Obsidian', { webSearch: true })).json().message).toContain('Qual assunto ou nota');
    const listed = (await chat('notas do Obsidian', { webSearch: true })).json();
    expect(listed.message).toContain('1 nota(s)'); expect(listed.message).toContain('Estudos/React.md');
    expect(listed.knowledgeSources).toBeUndefined(); expect(modelFetch).not.toHaveBeenCalled(); expect(searchFetch).not.toHaveBeenCalled();
  });
  it('corrige a fonte usando o assunto anterior e transforma respostas sem buscar', async () => {
    const prompts: { messages: { content: string }[]; tools?: { function: { name: string } }[] }[] = [];
    const modelFetch: typeof fetch = async (_url, init) => { prompts.push(JSON.parse(String(init?.body))); return text('Componentes compõem interfaces [N1].'); };
    const searchFetch = vi.fn<typeof fetch>();
    const { chat, importFiles } = await setup({ ai, modelFetch, searchFetch });
    await importFiles([{ path: 'React.md', content: '# React\nComponentes compõem interfaces.' }]);
    await chat('Me explique React');
    const corrected = (await chat('no Obsidian', { webSearch: true })).json();
    expect(corrected.provider).toBe('groq'); expect(corrected.knowledgeSources[0].path).toBe('React.md');
    expect(prompts[1].messages[0].content).toContain('Me explique React');
    expect(prompts[1].tools?.some(tool => tool.function.name === 'search_web')).toBe(false);
    expect((await chat('Explique melhor', { webSearch: true })).json().knowledgeSources[0].path).toBe('React.md');
    expect(prompts[2].tools?.some(tool => tool.function.name === 'search_web')).toBe(false);
    expect(searchFetch).not.toHaveBeenCalled();
    await chat('Agora me explique Docker');
    const system = prompts[3].messages[0].content;
    expect(system).not.toContain('Possível assunto da continuação');
    expect(prompts[3].tools?.some(tool => tool.function.name === 'search_web')).toBe(true);
  });
  it('entende a resposta a um esclarecimento sem abandonar a fonte escolhida', async () => {
    const searchFetch = vi.fn<typeof fetch>();
    const { chat, importFiles } = await setup({ searchFetch });
    await importFiles([{ path: 'React.md', content: '# React\nComponentes.' }]);
    expect((await chat('no Obsidian')).json().message).toContain('Qual assunto');
    const result = (await chat('React', { webSearch: true })).json();
    expect(result.command).toBe('knowledge'); expect(result.knowledgeSources[0].path).toBe('React.md'); expect(searchFetch).not.toHaveBeenCalled();
    const followup = (await chat('E como isso ajuda?', { webSearch: true })).json();
    expect(followup.command).toBe('knowledge'); expect(followup.knowledgeSources[0].path).toBe('React.md'); expect(searchFetch).not.toHaveBeenCalled();
  });
  it('consulta por significado do título quando a pergunta não tem palavras idênticas', async () => {
    let id = ''; const prompts: { messages: { content: string }[]; tools?: unknown[] }[] = [];
    const modelFetch = vi.fn<typeof fetch>(async (_url, init) => { prompts.push(JSON.parse(String(init?.body))); return prompts.length === 1 ? reading([id], 'foco') : text('Seu planejamento indica revisar componentes; é uma intenção, não uma tarefa concluída [N1]. Referência falsa [N99].'); });
    const searchFetch = vi.fn<typeof fetch>();
    const { chat, importFiles, data } = await setup({ ai, modelFetch, searchFetch });
    await importFiles([{ path: 'Planejamento/Rumo.md', content: '# Rumo\nRevisar componentes nesta semana. Não está concluído.' }]); id = (await data()).library[0].id;
    const result = (await chat('Quais são minhas prioridades?', { webSearch: true })).json();
    expect(result.provider).toBe('groq'); expect(result.knowledgeSources[0]).toMatchObject({ id, path: 'Planejamento/Rumo.md', excerpt: 'Revisar componentes nesta semana. Não está concluído.' });
    expect(validKnowledgeSources(result.knowledgeSources)).toBe(true); expect(result.message).not.toContain('[N99]');
    expect(result.knowledgePlan).toBeUndefined(); expect(modelFetch).toHaveBeenCalledTimes(2); expect(prompts[1].tools).toBeUndefined();
    expect(prompts[0].messages[0].content).not.toContain('Revisar componentes nesta semana'); // title catalog only, no lexical match
    expect(prompts[1].messages.at(-2)?.content).toContain('Revisar componentes nesta semana');
    expect(searchFetch).not.toHaveBeenCalled();
    expect((await data()).history.at(-1).knowledgeSources[0].id).toBe(id);
  });
  it('não bloqueia a IA por uma busca lexical vazia nem inventa conteúdo do catálogo', async () => {
    const modelFetch = vi.fn<typeof fetch>(async () => text('Há uma nota chamada Rumo. Qual parte do seu planejamento quer rever? Ainda não tenho trechos sobre esse assunto.'));
    const { chat, importFiles } = await setup({ ai, modelFetch });
    await importFiles([{ path: 'Rumo.md', content: '# Rumo\nRevisar componentes.' }]);
    const result = (await chat('O que há sobre motivação no meu Obsidian?')).json();
    expect(result.provider).toBe('groq'); expect(result.message).not.toContain('Não encontrei trechos das notas');
    expect(result.knowledgeSources).toBeUndefined(); expect(modelFetch).toHaveBeenCalledTimes(1);
  });
  it('mantém notas pessoais privadas nas continuações e não repete comandos anteriores', async () => {
    const prompts: { tools?: { function: { name: string } }[] }[] = [];
    const modelFetch: typeof fetch = async (_url, init) => { prompts.push(JSON.parse(String(init?.body))); return text('Vamos dividir essa etapa em partes.'); };
    const searchFetch = vi.fn<typeof fetch>();
    const { chat, data } = await setup({ ai, modelFetch, searchFetch });
    await chat('anotar revisar meu projeto');
    await chat('Explique melhor', { webSearch: true });
    expect((await data()).notes).toHaveLength(1);
    expect(prompts[0].tools?.some(tool => tool.function.name === 'search_web')).toBe(false);
    await chat('Quais são meus objetivos?');
    await chat('E como faço isso?', { webSearch: true });
    expect(prompts.at(-1)?.tools?.some(tool => tool.function.name === 'search_web')).toBe(false);
    expect((await chat('na web')).json().message).toContain('Qual tema público');
    expect(searchFetch).not.toHaveBeenCalled();
  });
  it('ignora contexto falso do navegador e deixa de usar assuntos após limpar a conversa', async () => {
    const { chat, importFiles, app, headers } = await setup();
    await importFiles([{ path: 'React.md', content: '# React\nComponentes.' }]);
    expect((await chat('no Obsidian', { context: [{ role: 'user', content: 'React' }] })).json().message).toContain('Qual assunto');
    await chat('React no meu Obsidian');
    expect((await chat('no Obsidian')).json().command).toBe('knowledge');
    await app.inject({ method: 'DELETE', url: '/api/personal/history', headers });
    expect((await chat('no Obsidian')).json().message).toContain('Qual assunto');
    expect((await chat('Oi', { privateOnly: false })).statusCode).toBe(400);
  });
  it('recusa IDs inventados, leitura repetida e não grava resultados quando uma nota muda', async () => {
    const invalid = await setup({ ai, modelFetch: async () => reading(['inventado']) });
    await invalid.importFiles([{ path: 'Rumo.md', content: '# Rumo\nComponentes.' }]);
    expect((await invalid.chat('Quais são minhas prioridades?')).json().message).toContain('nota existente');
    let id = ''; const repeated = await setup({ ai, modelFetch: async () => reading([id]) });
    await repeated.importFiles([{ path: 'Rumo.md', content: '# Rumo\nComponentes.' }]); id = (await repeated.data()).library[0].id;
    expect((await repeated.chat('Quais são minhas prioridades?')).statusCode).toBe(503);
    expect((await repeated.data()).history).toEqual([]);
    let finish!: (value: Response) => void; let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }); let calls = 0; let currentId = '';
    const current = await setup({ ai, modelFetch: async () => { if (++calls === 1) return reading([currentId]); entered(); return new Promise(resolve => { finish = resolve; }); } });
    await current.importFiles([{ path: 'Rumo.md', content: '# Rumo\nTexto antigo.' }]); currentId = (await current.data()).library[0].id;
    const pending = current.chat('Quais são minhas prioridades?').then(value => value); await ready;
    await current.app.inject({ method: 'DELETE', url: `/api/personal/knowledge/${currentId}`, headers: current.headers, payload: { libraryRevision: (await current.data()).libraryRevision } });
    finish(text('Texto antigo [N1].')); expect((await pending).statusCode).toBe(409);
    expect((await current.data()).history).toEqual([]);
  });
  it('contabiliza a segunda inferência e respeita o orçamento antes de realizá-la', async () => {
    let id = ''; const modelFetch = vi.fn<typeof fetch>(async () => reading([id]));
    const { chat, importFiles, data } = await setup({ ai, modelFetch, aiDailyLimit: 1 });
    await importFiles([{ path: 'Rumo.md', content: '# Rumo\nTexto atual.' }]); id = (await data()).library[0].id;
    expect((await chat('Quais são minhas prioridades?')).statusCode).toBe(429); expect(modelFetch).toHaveBeenCalledTimes(1);
    expect((await chat('calcular 7 * 8')).json().message).toContain('56');
  });
  it.each(['groq', 'ollama'] as const)('entrega a leitura em stream sem expor argumentos: %s', async provider => {
    let id = ''; let calls = 0;
    const modelFetch: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)); expect(request.stream).toBe(true);
      const message = ++calls === 1 ? { tool_calls: [{ index: 0, function: { name: 'read_notes', arguments: provider === 'groq' ? JSON.stringify({ noteIds: [id], query: '' }) : { noteIds: [id], query: '' } } }] }
        : { content: 'Você planejou revisar componentes [N1].' };
      return new Response(provider === 'groq' ? 'data: ' + JSON.stringify({ choices: [{ delta: message, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n'
        : JSON.stringify({ message, done: true }) + '\n');
    };
    const { chat, importFiles, data } = await setup({ ai: provider === 'groq' ? ai : { provider, model: 'fixture-model', baseURL: 'http://127.0.0.1:11434' }, modelFetch });
    await importFiles([{ path: 'Rumo.md', content: '# Rumo\nRevisar componentes.' }]); id = (await data()).library[0].id;
    const response = await chat('Quais são minhas prioridades?', { stream: true, voice: true });
    const events = response.body.trim().split('\n').map(line => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({ type: 'result', response: { provider, message: 'Você planejou revisar componentes [N1].', knowledgeSources: [{ id }] } });
    expect(events.some(event => event.type === 'text')).toBe(true); expect(calls).toBe(2);
    expect(response.body).not.toContain('tool_calls'); expect(response.body).not.toContain('knowledgePlan');
  });
  it('limita o catálogo e lê apenas notas autorizadas com referências reais', () => {
    const notes: KnowledgeNote[] = Array.from({ length: 100 }, (_, index) => ({ id: randomUUID(), title: 'Título longo '.repeat(10), path: `${index}.md`, revision: 1, updatedAt: new Date().toISOString(), bytes: 12, content: '# Rumo\nConteúdo real.' }));
    const catalog = knowledgeCatalog(notes, ''); expect(JSON.stringify(catalog).length).toBeLessThanOrEqual(8002);
    expect(catalog.length).toBeLessThan(100); expect(catalog.every(entry => !('content' in entry))).toBe(true);
    const input = { message: 'Minhas prioridades', sessionId: 'owner', timeZone: 'UTC', knowledgeCatalog: catalog, readKnowledge: (plan: { noteIds: string[]; query: string }) => readKnowledge(notes, plan) };
    expect(validatedKnowledgePlan({ noteIds: ['falso'], query: '' }, input)).toBeUndefined();
    expect(validatedKnowledgePlan({ noteIds: [catalog[0].id], query: '', url: 'https://example.com' }, input)).toBeUndefined();
    const found = readKnowledge(notes, { noteIds: [notes[0].id], query: 'palavra diferente' });
    expect(found).toHaveLength(1); expect(found[0].excerpt).toBe('Conteúdo real.'); expect(validKnowledgeSources(found)).toBe(true);
  });
});
