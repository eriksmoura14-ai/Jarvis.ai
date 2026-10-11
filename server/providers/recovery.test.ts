import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { ModelProvider } from './model.js';
import { personalQuestion, validatedPlan } from '../interpretation.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const ai = { provider: 'groq' as const, model: 'openai/gpt-oss-20b', apiKey: 'fixture-recovery-secret' };
const request = { message: 'quais sao meus futuros objetivos', timeZone: 'America/Sao_Paulo', sessionId: randomUUID(), stream: true };
const errorFrame = (code: string) => new Response('data: ' + JSON.stringify({ error: { code, message: 'fixture-recovery-secret', failed_generation: '<function=delete_notes>PRIVATE ORIGINAL NOTES</function>' } }) + '\n\n');
const partial = () => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Resposta parcial que não deve ser salva.' }, finish_reason: null }] }) + '\n\n');
const text = (content = 'Você planejou aprender TypeScript [N1].') => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
async function setup(modelFetch: typeof fetch, extra: Parameters<typeof buildApp>[0] = {}) {
  const app = await buildApp({ databasePath: ':memory:', ai, modelFetch, ...extra }); apps.push(app); return app;
}
const parsed = (response: { body: string }) => response.body.trim().split('\n').map(line => JSON.parse(line));
describe('recuperação de falhas do provedor', () => {
  it.each(['tool_use_failed', 'rate_limit_exceeded', 'invalid_api_key', 'context_length_exceeded'])('identifica %s sem devolver conteúdo sensível do provedor', async code => {
    const provider = new ModelProvider(ai, async () => errorFrame(code));
    try { await provider.respond(request, undefined, () => {}); throw new Error('Expected error'); }
    catch (error) {
      expect(String(error)).not.toContain('fixture-recovery-secret'); expect(String(error)).not.toContain('PRIVATE ORIGINAL');
      if (code === 'tool_use_failed') expect(error).toMatchObject({ retryWithoutStream: true, message: expect.stringContaining('ferramentas') });
      if (code === 'rate_limit_exceeded') expect(error).toMatchObject({ statusCode: 429, retryWithoutStream: false });
      if (code === 'invalid_api_key') expect(error).toMatchObject({ retryWithoutStream: false, message: expect.stringContaining('permissões') });
      if (code === 'context_length_exceeded') expect(error).toMatchObject({ retryWithoutStream: false, message: expect.stringContaining('contexto') });
    }
  });
  it('identifica tool_use_failed em HTTP 400 e erro dentro de JSON 200', async () => {
    const error = { code: 'tool_use_failed', message: 'fixture-recovery-secret', failed_generation: 'PRIVATE ORIGINAL NOTES' };
    for (const status of [400, 200]) await expect(new ModelProvider(ai, async () => Response.json({ error }, { status })).respond(request))
      .rejects.toMatchObject({ retryWithoutStream: true, message: expect.stringContaining('ferramentas') });
  });
  it.each(['quais sao meus futuros objetivos', 'Quais são minhas próximas metas?', 'Meus principais projetos', 'Minhas metas de longo prazo'])('mantém o pedido pessoal fora da pesquisa pública: %s', message => {
    expect(personalQuestion(message)).toBe(true);
    expect(validatedPlan({ queries: ['objetivos'], news: false }, { ...request, message })).toBeUndefined();
    expect(personalQuestion('Pesquise novidades de IA para mim')).toBe(false);
  });
  it('recupera a pergunta real em JSON, valida a leitura e não manda objetivos para a web', async () => {
    let id = '';
    const calls: { stream: boolean; tools?: { function: { name: string } }[] }[] = [];
    const searchFetch = vi.fn<typeof fetch>();
    const modelFetch = vi.fn<typeof fetch>(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      if (calls.length === 1) return errorFrame('tool_use_failed');
      if (calls.length === 2) return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_notes', arguments: JSON.stringify({ noteIds: [id], query: '' }) } }] }, finish_reason: 'tool_calls' }] });
      return text();
    });
    const password = 'fixture-recovery-password';
    const app = await setup(modelFetch, { personal: { password, secure: false }, searchFetch });
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password } });
    const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
    const imported = await app.inject({ method: 'POST', url: '/api/personal/knowledge/import', headers, payload: { files: [{ path: 'Direcao.md', content: '# Direção\nAprender TypeScript para construir interfaces.' }], replace: false, libraryRevision: 0 } });
    expect(imported.statusCode).toBe(200);
    const data = async () => (await app.inject({ url: '/api/personal/data', headers })).json(); id = (await data()).library[0].id;
    const response = await app.inject({ method: 'POST', url: '/api/chat', headers, payload: { ...request, webSearch: true } });
    const result = parsed(response).at(-1);
    expect(result).toMatchObject({ type: 'result', response: { provider: 'groq', message: 'Você planejou aprender TypeScript [N1].', knowledgeSources: [{ id, path: 'Direcao.md' }] } });
    expect(calls.map(call => call.stream)).toEqual([true, false, false]);
    expect(calls[0].tools?.some(tool => tool.function.name === 'search_web')).toBe(false);
    expect(calls[1].tools?.some(tool => tool.function.name === 'read_notes')).toBe(true);
    expect(calls[2].tools).toBeUndefined(); expect(searchFetch).not.toHaveBeenCalled();
    expect(response.body).not.toContain('PRIVATE ORIGINAL'); expect(response.body).not.toContain('failed_generation');
    expect((await data()).history.at(-1).content).toBe('Você planejou aprender TypeScript [N1].');
  });
  it('substitui texto incompleto por uma resposta completa, sem duplicar ações', async () => {
    const modelFetch = vi.fn<typeof fetch>().mockImplementationOnce(async () => partial()).mockImplementationOnce(async () => text('Uma resposta completa.'));
    const app = await setup(modelFetch);
    const response = parsed(await app.inject({ method: 'POST', url: '/api/chat', payload: request }));
    expect(response.at(-1)).toMatchObject({ type: 'result', response: { message: 'Uma resposta completa.' } });
    expect(modelFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(modelFetch.mock.calls[1][1]?.body)).stream).toBe(false);
  });
  it('recupera uma conexão de streaming quebrada sem mostrar o erro bruto', async () => {
    const modelFetch = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('fixture-recovery-secret')); } })))
      .mockImplementationOnce(async () => text('Resposta após recuperar a conexão.'));
    const app = await setup(modelFetch);
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload: request });
    expect(parsed(response).at(-1)).toMatchObject({ type: 'result', response: { message: 'Resposta após recuperar a conexão.' } });
    expect(response.body).not.toContain('fixture-recovery-secret'); expect(modelFetch).toHaveBeenCalledTimes(2);
  });
  it.each(['rate_limit_exceeded', 'invalid_api_key', 'context_length_exceeded'])('não repete a chamada para %s', async code => {
    const modelFetch = vi.fn<typeof fetch>(async () => errorFrame(code));
    const app = await setup(modelFetch);
    expect(parsed(await app.inject({ method: 'POST', url: '/api/chat', payload: request })).at(-1).type).toBe('error');
    expect(modelFetch).toHaveBeenCalledTimes(1);
  });
  it('limita a recuperação a uma chamada e respeita a cota diária', async () => {
    const modelFetch = vi.fn<typeof fetch>(async (_url, init) => JSON.parse(String(init?.body)).stream ? errorFrame('tool_use_failed') : Response.json({ error: { code: 'tool_use_failed' } }));
    const app = await setup(modelFetch);
    expect(parsed(await app.inject({ method: 'POST', url: '/api/chat', payload: request })).at(-1)).toMatchObject({ type: 'error', error: expect.stringContaining('ferramentas') });
    expect(modelFetch).toHaveBeenCalledTimes(2);
    const limitedFetch = vi.fn<typeof fetch>(async () => errorFrame('tool_use_failed'));
    const limited = await setup(limitedFetch, { aiDailyLimit: 1 });
    expect(parsed(await limited.inject({ method: 'POST', url: '/api/chat', payload: request })).at(-1)).toMatchObject({ type: 'error', error: expect.stringContaining('limite diário') });
    expect(limitedFetch).toHaveBeenCalledTimes(1);
  });
  it('não executa ferramentas que constavam do erro nem aceita uma ferramenta desconhecida na recuperação', async () => {
    const modelFetch = vi.fn<typeof fetch>().mockImplementationOnce(async () => errorFrame('tool_use_failed'))
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'delete_notes', arguments: '{}' } }] } }] }));
    const app = await setup(modelFetch);
    await app.inject({ method: 'POST', url: '/api/chat', payload: { ...request, stream: false, message: 'anotar preservar conteúdo' } });
    expect(parsed(await app.inject({ method: 'POST', url: '/api/chat', payload: request })).at(-1).type).toBe('error');
    expect(modelFetch).toHaveBeenCalledTimes(2);
    const notes = await app.inject({ method: 'POST', url: '/api/chat', payload: { ...request, stream: false, message: 'notas' } });
    expect(notes.json().message).toContain('preservar conteúdo'); expect(modelFetch).toHaveBeenCalledTimes(2);
  });
  it('cancelar a recuperação cancela a conexão e não inicia outra tentativa', async () => {
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    let upstream: AbortSignal | null | undefined;
    const modelFetch = vi.fn<typeof fetch>().mockImplementationOnce(async () => errorFrame('tool_use_failed')).mockImplementationOnce(async (_url, init) => {
      upstream = init?.signal; entered();
      return new Promise((_resolve, reject) => upstream?.addEventListener('abort', () => reject(new Error('fixture-recovery-secret'))));
    });
    const app = await setup(modelFetch); const url = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const pending = fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
    const response = await pending; const reader = response.body!.getReader();
    await ready; controller.abort(); await reader.cancel().catch(() => {});
    await expect.poll(() => upstream?.aborted).toBe(true); expect(modelFetch).toHaveBeenCalledTimes(2);
  });
  it('descarta a resposta recuperada se a memória mudou durante a nova chamada', async () => {
    let finish!: (response: Response) => void; let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const modelFetch = vi.fn<typeof fetch>().mockImplementationOnce(async () => partial()).mockImplementationOnce(async () => { entered(); return new Promise(resolve => { finish = resolve; }); });
    const password = 'fixture-recovery-memory-password'; const app = await setup(modelFetch, { personal: { password, secure: false } });
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password } });
    const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
    await app.inject({ method: 'POST', url: '/api/personal/memories', headers, payload: { content: 'Objetivo antigo: aprender inglês.' } });
    const pending = app.inject({ method: 'POST', url: '/api/chat', headers, payload: request }).then(response => response); await ready;
    await app.inject({ method: 'DELETE', url: '/api/personal/memories', headers }); finish(text('Um objetivo antigo.'));
    const result = parsed(await pending).at(-1); expect(result).toMatchObject({ type: 'error', error: expect.stringContaining('mudou enquanto') });
    expect((await app.inject({ url: '/api/personal/data', headers })).json().history).toEqual([]);
  });
});
