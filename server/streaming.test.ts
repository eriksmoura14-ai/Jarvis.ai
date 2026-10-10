import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { ModelProvider } from './providers/model.js';
import type { ChatStreamEvent } from '../shared/contracts.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const config = { provider: 'groq' as const, model: 'openai/gpt-oss-20b', apiKey: 'fixture-stream-secret' };
const body = { message: 'Explique de forma simples', sessionId: randomUUID(), timeZone: 'America/Sao_Paulo', stream: true, voice: true };
const sse = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content, reasoning: 'private reasoning' }, finish_reason: finish }] })}\n\n`;
const response = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
const events = (text: string) => text.trim().split('\n').map(line => JSON.parse(line) as ChatStreamEvent);
async function setup(options: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const app = await buildApp({ databasePath: ':memory:', ai: config, ...options }); apps.push(app); return app;
}

describe('resposta progressiva', () => {
  it('transmite texto do Groq e ignora raciocínio; não inventa fallback para JSON incompleto', async () => {
    const transport = vi.fn<typeof fetch>(async () => response(sse('Uma resposta ') + sse('útil.', 'stop') + 'data: [DONE]\n\n'));
    const chunks: string[] = [];
    const result = await new ModelProvider(config, transport).respond(body, undefined, text => chunks.push(text));
    expect(chunks).toEqual(['Uma resposta ', 'Uma resposta útil.']);
    expect(result.message).toBe('Uma resposta útil.');
    const sent = JSON.parse(transport.mock.calls[0][1]?.body as string);
    expect(sent.stream).toBe(true); expect(sent.messages[0].content).toContain('Esta resposta será ouvida');
    expect(JSON.stringify(result)).not.toContain('private reasoning');
    await expect(new ModelProvider(config, async () => response(sse('incompleta'))).respond(body, undefined, () => {})).rejects.toThrow('interrompida');
  });
  it('suporta o NDJSON de Ollama com fim explícito e UTF-8 em partes', async () => {
    const encoder = new TextEncoder(); const bytes = encoder.encode('{"message":{"content":"Olá "},"done":false}\n{"message":{"content":"senhor."},"done":true}\n');
    const transport: typeof fetch = async () => new Response(new ReadableStream({ start(controller) {
      for (let index = 0; index < bytes.length; index++) controller.enqueue(bytes.slice(index, index + 1));
      controller.close();
    } }));
    const chunks: string[] = [];
    const result = await new ModelProvider({ provider: 'ollama', model: 'fixture', baseURL: 'http://127.0.0.1:11434' }, transport).respond(body, undefined, text => chunks.push(text));
    expect(chunks).toEqual(['Olá ', 'Olá senhor.']); expect(result.message).toBe('Olá senhor.');
  });
  it.each([response('data: invalid\n'), response(sse('') + 'data: [DONE]\n'), response('data: {"error":"fixture-stream-secret"}\n')])('sanitiza stream inválido ou erro externo', async external => {
    await expect(new ModelProvider(config, async () => external).respond(body, undefined, () => {})).rejects.not.toThrow('fixture-stream-secret');
  });
  it('mantém o protocolo JSON e oferece eventos, tempos e comandos locais sem IA', async () => {
    const transport = vi.fn<typeof fetch>(async () => response(sse('Olá, senhor.', 'stop') + 'data: [DONE]\n\n'));
    const app = await setup({ modelFetch: transport });
    const stream = await app.inject({ method: 'POST', url: '/api/chat', payload: body });
    expect(stream.headers['content-type']).toContain('application/x-ndjson');
    const values = events(stream.body); expect(values[0]).toEqual({ type: 'ready' });
    expect(values.some(event => event.type === 'text' && event.text === 'Olá, senhor.')).toBe(true);
    const final = values.at(-1); expect(final?.type).toBe('result');
    if (final?.type !== 'result') throw new Error('No result');
    expect(final.response).toMatchObject({ message: 'Olá, senhor.', timings: { preparationMs: expect.any(Number), answerMs: expect.any(Number), saveMs: expect.any(Number), firstTextMs: expect.any(Number) } });
    const local = await app.inject({ method: 'POST', url: '/api/chat', payload: { ...body, message: 'calcular 3 + 4' } });
    expect(events(local.body).at(-1)).toMatchObject({ type: 'result', response: { message: 'O resultado é 7.', provider: 'local' } });
    const json = await app.inject({ method: 'POST', url: '/api/chat', payload: { ...body, stream: false, message: 'hora' } });
    expect(json.json()).toMatchObject({ command: 'time' }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('o primeiro texto chega antes do fim numa conexão HTTP real; fechar cancela o modelo', async () => {
    let signal: AbortSignal | null | undefined;
    const app = await setup({ modelFetch: async (_url, options) => {
      signal = options?.signal;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(sse('Primeira frase.')));
        signal?.addEventListener('abort', () => controller.error(new Error('canceled')));
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    } });
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const reply = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const reader = reply.body!.getReader(); let text = '';
    while (!text.includes('Primeira frase.')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).not.toContain('"type":"result"');
    controller.abort(); await reader.cancel().catch(() => {});
    await expect.poll(() => signal?.aborted).toBe(true);
  });
  it('mudança de memória invalida uma resposta parcial e não restaura fatos apagados', async () => {
    let finish = () => {};
    let started = () => {}; const ready = new Promise<void>(resolve => { started = resolve; });
    const app = await setup({ personal: { password: 'fixture-stream-login-123', secure: false }, modelFetch: async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(sse('Fato antigo.'))); started();
      finish = () => { controller.enqueue(new TextEncoder().encode(sse(' Última parte.', 'stop') + 'data: [DONE]\n\n')); controller.close(); };
    } })) });
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password: 'fixture-stream-login-123' } });
    const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
    await app.inject({ method: 'POST', url: '/api/personal/memories', headers, payload: { content: 'Fato antigo' } });
    const pending = app.inject({ method: 'POST', url: '/api/chat', headers, payload: body });
    await ready;
    await app.inject({ method: 'DELETE', url: '/api/personal/memories', headers }); finish();
    const values = events((await pending).body);
    expect(values.some(event => event.type === 'text')).toBe(true);
    expect(values.at(-1)).toMatchObject({ type: 'error', error: expect.stringContaining('mudou enquanto') });
    expect(values.some(event => event.type === 'result')).toBe(false);
    const snapshot = (await app.inject({ url: '/api/personal/data', headers })).json();
    expect(snapshot.history).toHaveLength(0); expect(snapshot.memories).toHaveLength(0);
  });
  it('pesquisa interrompida troca resumo parcial pelas fontes verdadeiras', async () => {
    const app = await setup({ modelFetch: async () => response(sse('Resumo incompleto.')),
      searchFetch: async () => new Response('<div class="result"><a class="result__a" href="https://react.dev/learn">React</a><a class="result__snippet">Guia de interfaces.</a></div>', { headers: { 'Content-Type': 'text/html' } }) });
    const values = events((await app.inject({ method: 'POST', url: '/api/chat', payload: { ...body, message: 'pesquise React' } })).body);
    expect(values.at(-1)).toMatchObject({ type: 'result', response: { provider: 'local', command: 'search', message: expect.stringContaining('resumo por IA está indisponível'), sources: [{ url: 'https://react.dev/learn', title: 'React', snippet: 'Guia de interfaces.' }] } });
  });
});
