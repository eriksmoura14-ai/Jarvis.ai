import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ModelProvider, readAIConfig } from './model.js';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';
const apps: FastifyInstance[] = [];
const servers: Server[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
const request = { message: 'Explique React', sessionId: randomUUID(), timeZone: 'America/Sao_Paulo', context: [{ role: 'user' as const, content: 'Quero aprender programação' }, { role: 'assistant' as const, content: 'Vamos começar com interfaces' }] };

describe('conexões de modelo', () => {
  it('valida configuração sem exigir chave para modo local ou Ollama', () => {
    expect(readAIConfig({})).toBeUndefined();
    expect(() => readAIConfig({ AI_PROVIDER: 'invalid' })).toThrow('AI_PROVIDER');
    expect(() => readAIConfig({ AI_PROVIDER: 'groq', AI_MODEL: 'model' })).toThrow('GROQ_API_KEY');
    expect(() => readAIConfig({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'test-secret' })).toThrow('AI_MODEL');
    expect(readAIConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'model' })).toMatchObject({ baseURL: 'http://127.0.0.1:11434' });
    expect(() => readAIConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'model', OLLAMA_URL: 'https://user:secret@example.com' })).toThrow();
  });
  it('envia contexto ordenado e chave somente ao endpoint fixo do Groq', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: 'React cria interfaces.' } }] }));
    const provider = new ModelProvider({ provider: 'groq', model: 'configured-model', apiKey: 'test-secret' }, transport);
    const response = await provider.respond(request);
    expect(response).toMatchObject({ provider: 'groq', command: 'conversation', message: 'React cria interfaces.' });
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-secret' });
    const body = JSON.parse(options?.body as string);
    expect(body.messages.slice(1)).toEqual([...request.context, { role: 'user', content: request.message }]);
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[0].content).toContain('Não diga que apagou notas');
    expect(JSON.stringify(response)).not.toContain('test-secret');
  });
  it.each([401, 403, 404, 429, 500])('trata HTTP %s sem repassar segredos do provedor', async status => {
    const transport = vi.fn<typeof fetch>(async () => new Response('test-secret', { status }));
    const provider = new ModelProvider({ provider: 'groq', model: 'model', apiKey: 'test-secret' }, transport);
    await expect(provider.respond(request)).rejects.not.toThrow('test-secret');
    if (status === 429) await expect(provider.respond(request)).rejects.toMatchObject({ statusCode: 429 });
  });
  it('usa esforço baixo no GPT-OSS e avisa quando o provedor corta a resposta', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: 'Um resumo incompleto', reasoning: 'Não deve aparecer no chat' }, finish_reason: 'length' }] }));
    const provider = new ModelProvider({ provider: 'groq', model: 'openai/gpt-oss-20b', apiKey: 'test-secret' }, transport);
    const response = await provider.respond(request);
    const body = JSON.parse(transport.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ reasoning_effort: 'low', include_reasoning: false, max_completion_tokens: 1024 });
    expect(body).not.toHaveProperty('max_tokens');
    expect(response.message).toContain('A resposta atingiu o limite');
    expect(response.message).not.toContain('Não deve aparecer no chat');
  });
  it.each([
    [undefined, 'por minuto ou por dia'],
    ['86400', '24 horas'],
    ['120', '2 minutos'],
    ['3601', '1 hora e 1 minuto'],
    ['1', '1 segundo'],
    ['0', '0 segundos'],
    ['credential-secret', 'por minuto ou por dia'],
    ['999999999999', 'por minuto ou por dia'],
    ['-1', 'por minuto ou por dia'],
  ])('informa somente o prazo válido recebido do provedor: %s', async (retryAfter, expected) => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ error: { code: 'rate_limit_exceeded', message: 'credential-secret' } }, {
      status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {},
    }));
    const provider = new ModelProvider({ provider: 'groq', model: 'model', apiKey: 'test-secret' }, transport);
    await expect(provider.respond(request)).rejects.toMatchObject({ statusCode: 429, retryWithoutStream: false, message: expect.stringContaining(expected) });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('entende Retry-After como data HTTP sem prometer um reset de um minuto', async () => {
    const timestamp = Date.now(); const date = new Date(timestamp + 3600_000).toUTCString();
    const now = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
    try {
      const provider = new ModelProvider({ provider: 'groq', model: 'model', apiKey: 'test-secret' }, async () => new Response('', { status: 429, headers: { 'Retry-After': date } }));
      await expect(provider.respond(request)).rejects.toMatchObject({ message: expect.stringContaining('1 hora'), retryWithoutStream: false });
    } finally { now.mockRestore(); }
  });
  it('envia catálogo para selecionar notas, mas somente evidências na resposta final', async () => {
    const catalog = Array.from({ length: 51 }, (_, i) => ({ id: randomUUID(), title: `Direção ${i}`, path: `Planos/Direcao-${i}.md` }));
    const source = { reference: 'N1', ...catalog[0], revision: 3, heading: 'Estudos', excerpt: 'Aprender TypeScript para construir interfaces.' };
    const transport = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      return body.tools ? Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_notes', arguments: JSON.stringify({ noteIds: [source.id], query: '' }) } }] } }] })
        : Response.json({ choices: [{ message: { content: 'Você planejou aprender TypeScript [N1].' } }] });
    });
    const provider = new ModelProvider({ provider: 'groq', model: 'model', apiKey: 'test-secret' }, transport);
    const input = { ...request, message: 'quais sao meus futuros objetivos', knowledgeCatalog: catalog, knowledgeCount: 51, readKnowledge: () => [source] };
    expect(await provider.respond(input, undefined, undefined, undefined, true)).toMatchObject({ knowledgePlan: { noteIds: [source.id], query: '' } });
    expect(await provider.respond({ ...input, readKnowledge: undefined, knowledgeContext: [source], knowledgeOnly: true, privateOnly: true })).toMatchObject({ message: expect.stringContaining('[N1]') });
    const first = JSON.parse(String(transport.mock.calls[0][1]?.body)); const final = JSON.parse(String(transport.mock.calls[1][1]?.body));
    expect(first.messages[0].content).toContain(catalog[50].id);
    expect(final.messages[0].content).not.toContain('Catálogo atual');
    expect(final.messages[0].content).not.toContain(catalog[50].title);
    expect(final.messages[0].content).toContain(source.excerpt);
    expect(final.messages[0].content).toContain(source.path);
    expect(final.messages[0].content).toContain('"reference":"N1"');
    expect(final.messages[0].content).toContain('não leitura completa do cofre');
    expect(final.messages[0].content.length).toBeLessThan(first.messages[0].content.length);
    expect(final.tools).toBeUndefined();
  });
  it.each([{}, { choices: [] }, { choices: [{ message: { content: ' ' } }] }])('rejeita respostas vazias %j', async data => {
    const provider = new ModelProvider({ provider: 'groq', model: 'model', apiKey: 'test-secret' }, async () => Response.json(data));
    await expect(provider.respond(request)).rejects.toThrow('texto válido');
  });
  it('limita resposta, trata JSON inválido e encerra requisição com timeout', async () => {
    const config = { provider: 'groq' as const, model: 'model', apiKey: 'test-secret' };
    await expect(new ModelProvider(config, async () => new Response('x'.repeat(100_001))).respond(request)).rejects.toThrow('excedeu');
    await expect(new ModelProvider(config, async () => new Response('invalid')).respond(request)).rejects.toThrow('conectar');
    const transport: typeof fetch = async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('secret'))));
    await expect(new ModelProvider(config, transport, 15).respond(request)).rejects.toThrow('demorou');
  });
  it('Ollama recebe uma requisição HTTP real e comandos locais não acionam o modelo', async () => {
    const calls: { path: string; body: { messages: { role: string; content: string }[]; stream: boolean } }[] = [];
    const server = createServer(async (incoming, outgoing) => {
      let body = '';
      for await (const chunk of incoming) body += chunk;
      calls.push({ path: incoming.url!, body: JSON.parse(body) });
      outgoing.setHeader('Content-Type', 'application/json');
      outgoing.end(JSON.stringify({ message: { role: 'assistant', content: 'Uma biblioteca para interfaces.' } }));
    });
    servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address() as { port: number };
    const app = await buildApp({ databasePath: ':memory:', ai: { provider: 'ollama', model: 'test-model', baseURL: `http://127.0.0.1:${address.port}` }, aiDailyLimit: 1, allowedOrigins: ['https://eriksmoura14-ai.github.io'] });
    apps.push(app);
    expect((await app.inject('/api/health')).json()).toMatchObject({ ai: { configured: true, provider: 'ollama', model: 'test-model' } });
    const help = (await app.inject({ method: 'POST', url: '/api/chat', payload: { ...request, message: 'ajuda' } })).json();
    expect(help.message).toContain('modelo configurado');
    expect(help.message).not.toContain('Ainda não uso um modelo de IA');
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload: request });
    expect(response.json()).toMatchObject({ provider: 'ollama', command: 'conversation', message: 'Uma biblioteca para interfaces.' });
    expect(calls).toHaveLength(1); expect(calls[0].path).toBe('/api/chat');
    expect(calls[0].body.messages.slice(1)).toEqual([...request.context, { role: 'user', content: request.message }]);
    expect(calls[0].body.stream).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: request })).statusCode).toBe(429);
    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: { ...request, message: 'anotar estudar React' } })).json()).toMatchObject({ provider: 'local', command: 'note-add' });
    expect(calls).toHaveLength(1);
  });
  it('interromper uma requisição real cancela também a chamada ao modelo', async () => {
    let upstreamSignal: AbortSignal | null | undefined;
    let started: () => void = () => {};
    const ready = new Promise<void>(resolve => { started = resolve; });
    const transport: typeof fetch = async (_url, options) => new Promise((_resolve, reject) => {
      upstreamSignal = options?.signal; started();
      upstreamSignal?.addEventListener('abort', () => reject(new Error('interrupted')));
    });
    const app = await buildApp({ databasePath: ':memory:', ai: { provider: 'groq', model: 'test', apiKey: 'test-secret' }, modelFetch: transport });
    apps.push(app);
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const pending = fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal }).catch(error => error.name);
    await ready; controller.abort();
    expect(await pending).toBe('AbortError');
    await expect.poll(() => upstreamSignal?.aborted).toBe(true);
  });
});
