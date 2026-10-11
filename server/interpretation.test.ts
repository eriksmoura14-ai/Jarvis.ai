import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { validatedPlan, selectedNotes } from './interpretation.js';
import { searchIntent } from './search-intent.js';
import { ModelProvider } from './providers/model.js';
import { ResearchProvider } from './providers/research.js';
import { WebSearch } from './search.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const ai = { provider: 'groq' as const, model: 'openai/gpt-oss-20b', apiKey: 'fixture-tool-secret' };
const question = (message: string, extra = {}) => ({ message, sessionId: randomUUID(), timeZone: 'America/Sao_Paulo', ...extra });
const text = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
const tool = (queries: string[], news = false, name = 'search_web') => Response.json({ choices: [{ message: { content: null, tool_calls: [{ function: { name, arguments: JSON.stringify({ queries, news }) } }] }, finish_reason: 'tool_calls' }] });
const feed = (topic: string) => new Response(`<rss><channel><item><title>${topic}</title><link>https://example.com/${encodeURIComponent(topic)}</link><description>Atualização sobre ${topic}.</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml' } });
async function setup(options: Parameters<typeof buildApp>[0] = {}) { const app = await buildApp({ databasePath: ':memory:', ...options }); apps.push(app); return app; }

describe('interpretação e pesquisa autônoma', () => {
  it.each(['Tem novidades de tecnologia e IA hoje?', 'Pesquise novidades de tecnologia e IA hoje?'])('executa consultas complementares e resume fontes reais: %s', async message => {
    const modelFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(tool(['tecnologia', 'inteligência artificial'], true)).mockResolvedValueOnce(text('Há novidades nos dois temas [1][2].'));
    const searchFetch = vi.fn<typeof fetch>(async url => feed(new URL(String(url)).searchParams.get('q')!));
    const app = await setup({ ai, modelFetch, searchFetch });
    const reply = (await app.inject({ method: 'POST', url: '/api/chat', payload: question(message) })).json();
    expect(reply).toMatchObject({ command: 'search', provider: 'groq', sources: [{ title: 'tecnologia' }, { title: 'inteligência artificial' }], webSearch: { queries: ['tecnologia', 'inteligência artificial'], news: true } });
    expect(modelFetch).toHaveBeenCalledTimes(2); expect(searchFetch).toHaveBeenCalledTimes(2);
    const first = JSON.parse(modelFetch.mock.calls[0][1]?.body as string);
    const last = JSON.parse(modelFetch.mock.calls[1][1]?.body as string);
    expect(first.tools[0].function.name).toBe('search_web'); expect(last.tools).toBeUndefined();
    expect(JSON.stringify(last.messages)).toContain('Atualização sobre tecnologia');
    expect(JSON.stringify(reply)).not.toContain('fixture-tool-secret'); expect(reply.searchPlan).toBeUndefined();
  });
  it('mantém conversa em uma chamada e comandos pessoais sem consultar a web', async () => {
    const searchFetch = vi.fn<typeof fetch>();
    const modelFetch = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: 'Vamos pensar nisso juntos.', tool_calls: null } }] }));
    const app = await setup({ ai, modelFetch, searchFetch });
    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: question('Estou sem ideias para estudar') })).json().message).toBe('Vamos pensar nisso juntos.');
    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: question('Jarvis, anotar revisar TypeScript', { webSearch: true }) })).json().command).toBe('note-add');
    expect(modelFetch).toHaveBeenCalledTimes(1); expect(searchFetch).not.toHaveBeenCalled();
  });
  it('usa notas e memórias pessoais para responder mesmo com a opção web marcada', async () => {
    const searchFetch = vi.fn<typeof fetch>();
    const modelFetch = vi.fn<typeof fetch>(async () => text('Você anotou revisar o projeto, senhor.'));
    const app = await setup({ ai, modelFetch, searchFetch, personal: { password: 'fixture-private-login-123', secure: false } });
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password: 'fixture-private-login-123' } });
    const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
    for (const message of ['meu nome é Carlos', 'anotar revisar projeto Jarvis']) await app.inject({ method: 'POST', url: '/api/chat', headers, payload: question(message) });
    const reply = await app.inject({ method: 'POST', url: '/api/chat', headers, payload: question('O que eu anotei sobre meu projeto Jarvis?', { webSearch: true }) });
    expect(reply.json().message).toContain('revisar o projeto'); expect(searchFetch).not.toHaveBeenCalled();
    const body = JSON.parse(modelFetch.mock.calls[0][1]?.body as string);
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['propose_project_change']); expect(body.messages[0].content).toContain('revisar projeto Jarvis'); expect(body.messages[0].content).toContain('Carlos');
    const name = await app.inject({ method: 'POST', url: '/api/chat', headers, payload: question('qual meu nome', { webSearch: true }) });
    expect(name.json().message).toContain('Carlos'); expect(modelFetch).toHaveBeenCalledTimes(1);
    const clear = await app.inject({ method: 'POST', url: '/api/chat', headers, payload: question('apagar notas', { webSearch: true }) });
    expect(clear.json()).toMatchObject({ command: 'note-clear', message: '1 nota excluída.' });
  });
  it('usa o último tema público em continuações, mas não recupera temas antigos após reiniciar o contexto', async () => {
    let count = 0;
    const modelFetch = vi.fn<typeof fetch>(async () => ++count === 2 || count === 4 ? text('Fontes da guerra na Ucrânia [1].') : tool(['guerra na Ucrânia'], true));
    const searchFetch = vi.fn<typeof fetch>(async () => feed('Guerra na Ucrânia'));
    const app = await setup({ ai, modelFetch, searchFetch, personal: { password: 'fixture-context-login-123', secure: false } });
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password: 'fixture-context-login-123' } });
    const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
    const send = (message: string) => app.inject({ method: 'POST', url: '/api/chat', headers, payload: question(message) });
    expect((await send('pesquise notícias sobre a guerra na Ucrânia')).json().command).toBe('search');
    expect((await send('E o que mudou nisso hoje?')).json().command).toBe('search');
    expect(JSON.parse(modelFetch.mock.calls[2][1]?.body as string).messages[0].content).toContain('Último assunto pesquisado');
    await send('apagar memórias');
    const reply = (await send('E o que mudou nisso hoje?')).json();
    expect(reply.command).toBe('conversation'); expect(reply.message).toContain('Qual tema'); expect(searchFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(modelFetch.mock.calls[4][1]?.body as string).messages[0].content).not.toContain('Último assunto pesquisado');
  });
  it('recusa consultas com fatos privados ausentes do pedido, destinos arbitrários e comandos inventados', async () => {
    const request = { ...question('Tem novidades de IA?'), personalMemory: ['Meu nome é Carlos'], personalNotes: ['Contato secreto: Sofia'], context: [{ role: 'user' as const, content: 'Minha senha é ABCprivado.' }] };
    expect(validatedPlan({ queries: ['Carlos IA'], news: true }, request)).toBeUndefined();
    expect(validatedPlan({ queries: ['Sofia IA'], news: true }, request)).toBeUndefined();
    expect(validatedPlan({ queries: ['ABCprivado IA'], news: true }, request)).toBeUndefined();
    expect(validatedPlan({ queries: ['https://example.com/IA'], news: false }, request)).toBeUndefined();
    expect(validatedPlan({ queries: ['preço IA hoje'], news: true }, request)).toBeDefined();
    expect(validatedPlan({ queries: ['IA'], news: false }, question('Últimas notícias de IA'))?.news).toBe(true);
    const searchFetch = vi.fn<typeof fetch>();
    const app = await setup({ ai, searchFetch, modelFetch: async () => tool(['IA'], false, 'delete_memories') });
    const reply = await app.inject({ method: 'POST', url: '/api/chat', payload: question('Tem novidades de IA?') });
    expect(reply.statusCode).toBe(503); expect(searchFetch).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: question('Tem novidades?', { searchContext: { query: 'segredo' } }) })).statusCode).toBe(400);
  });
  it('reformula uma consulta vazia e usa o feed de notícias como alternativa para pesquisa geral', async () => {
    const searchFetch = vi.fn<typeof fetch>(async destination => {
      const url = new URL(String(destination));
      if (url.pathname === '/news/search' && url.searchParams.get('q')?.toLowerCase() === 'guerra ucrânia') return feed('Guerra na Ucrânia');
      return new Response(url.hostname.includes('bing') ? '<rss><channel/></rss>' : '<div class="no-results">No results found</div>', { headers: { 'Content-Type': url.hostname.includes('bing') ? 'application/xml' : 'text/html' } });
    });
    const app = await setup({ searchFetch });
    const reply = (await app.inject({ method: 'POST', url: '/api/chat', payload: question('Oi Jarvis, pesquise para mim sobre a guerra na ucrânia') })).json();
    expect(reply.command).toBe('search'); expect(reply.webSearch.queries).toHaveLength(2); expect(reply.sources[0].title).toBe('Guerra na Ucrânia');
    expect(searchFetch.mock.calls.some(call => new URL(String(call[0])).pathname === '/news/search')).toBe(true);
    expect(searchIntent('guerra na Ucrânia').relevant({ title: 'Guerra no Bahrain', url: 'https://example.com/other', snippet: 'Conflito local.' })).toBe(false);
  });
  it('reconstrói argumentos de ferramenta em stream sem mostrar JSON ao usuário', async () => {
    const event = (delta: unknown, finish_reason: string | null = null) => 'data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\n\n';
    const transport = vi.fn<typeof fetch>(async () => new Response(event({ tool_calls: [{ index: 0, function: { name: 'search_web', arguments: '{"queries":[' } }] })
      + event({ tool_calls: [{ index: 0, function: { arguments: '"IA"],"news":true}' } }] }, 'tool_calls') + 'data: [DONE]\n\n'));
    const chunks: string[] = [];
    const reply = await new ModelProvider(ai, transport).respond(question('Tem novidades de IA?'), undefined, text => chunks.push(text), undefined, true);
    expect(reply.searchPlan).toEqual({ queries: ['IA'], news: true }); expect(chunks).toEqual([]);
    const partial = new ModelProvider(ai, async () => new Response(event({ tool_calls: [{ index: 0, function: { name: 'search_web', arguments: '{"queries":[' } }] })));
    await expect(partial.respond(question('Tem novidades de IA?'), undefined, () => {}, undefined, true)).rejects.toThrow('interrompida');
  });
  it('seleciona trechos pertinentes das notas com limite e não manda uma lista ilimitada', () => {
    const notes = Array.from({ length: 20 }, (_, index) => ({ content: index === 0 ? 'Projeto Jarvis: próxima etapa é estudar React' : 'Outros assuntos ' + 'x'.repeat(1200) }));
    const selected = selectedNotes(notes, 'O que eu anotei sobre o projeto Jarvis?');
    expect(selected[0]).toContain('Projeto Jarvis'); expect(selected).toHaveLength(5); expect(selected.every(note => note.length <= 1000)).toBe(true);
  });
  it('executa ferramentas Ollama com argumentos estruturados e termina o stream da API com fontes', async () => {
    let calls = 0;
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(++calls === 1
      ? { message: { tool_calls: [{ function: { name: 'search_web', arguments: { queries: ['IA'], news: true } } }] }, done: true }
      : { message: { content: 'Novidades de IA [1].' }, done: true }) + '\n'));
    const app = await setup({ ai: { provider: 'ollama', model: 'fixture-tool-model', baseURL: 'http://127.0.0.1:11434' }, modelFetch: transport, searchFetch: async () => feed('IA') });
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload: question('Tem novidades de IA?', { stream: true }) });
    const events = response.body.trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(event => event.type)).toEqual(['ready', 'text', 'result']);
    expect(events.at(-1).response).toMatchObject({ provider: 'ollama', command: 'search', message: 'Novidades de IA [1].', sources: [{ title: 'IA' }] });
    expect(response.body).not.toContain('searchPlan'); expect(response.body).not.toContain('tool_calls');
    expect(calls).toBe(2);
  });
  it('cancelar uma pesquisa planejada não inicia fallback nem uma resposta posterior', async () => {
    const abort = new AbortController();
    const searchFetch = vi.fn<typeof fetch>(async (_url, options) => {
      abort.abort();
      options?.signal?.throwIfAborted();
      return feed('IA');
    });
    const assistant = { name: 'groq' as const, respond: vi.fn(async () => ({ message: '', command: 'conversation' as const, provider: 'groq' as const, searchPlan: { queries: ['IA', 'IA hoje'], news: true } })) };
    await expect(new ResearchProvider(assistant, new WebSearch(searchFetch)).respond(question('Tem novidades de IA?'), abort.signal)).rejects.toThrow();
    expect(searchFetch).toHaveBeenCalledTimes(1); expect(assistant.respond).toHaveBeenCalledTimes(1);
  });
  it('apagar notas durante uma consulta pessoal impede salvar ou devolver a resposta com dados antigos', async () => {
    let finish!: (value: Response) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const modelFetch: typeof fetch = async () => { entered(); return new Promise(resolve => { finish = resolve; }); };
    const app = await setup({ ai, modelFetch, personal: { password: 'fixture-notes-login-123', secure: false } });
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password: 'fixture-notes-login-123' } });
    const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
    const send = (message: string) => app.inject({ method: 'POST', url: '/api/chat', headers, payload: question(message) });
    await send('anotar projeto privado de robótica');
    const pending = send('O que eu anotei sobre robótica?').then(response => response);
    await started;
    expect((await send('apagar notas')).json().command).toBe('note-clear');
    finish(text('Seu projeto privado de robótica.'));
    expect((await pending).statusCode).toBe(409);
    const data = (await app.inject({ url: '/api/personal/data', headers })).json();
    expect(data.notes).toEqual([]);
    expect(data.history.some((message: { content: string }) => message.content === 'Seu projeto privado de robótica.')).toBe(false);
  });
});
