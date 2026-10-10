import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { LocalProvider } from './providers/local.js';
import { NoteStore } from './database.js';

const apps: FastifyInstance[] = [];
const directories: string[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
async function setup(databasePath = ':memory:') { const app = await buildApp({ databasePath }); apps.push(app); return app; }
const payload = (message: string, sessionId = randomUUID()) => ({ message, sessionId, timeZone: 'America/Sao_Paulo' });
const chat = (app: FastifyInstance, message: string, sessionId?: string) => app.inject({ method: 'POST', url: '/api/chat', payload: payload(message, sessionId) });

describe('API e comandos locais', () => {
  it('responde ao health check e ao chat com o provedor real', async () => {
    const app = await setup();
    expect((await app.inject('/api/health')).json()).toEqual({ status: 'ok', provider: 'local', version: '0.1.0', streaming: true, webSearch: { enabled: true } });
    const response = await chat(app, 'calcular (12 + 8) / 2');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ message: 'O resultado é 10.', command: 'calculate', provider: 'local' });
    expect(response.json().id).toMatch(/^[\da-f-]{36}$/);
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it.each(['ajuda', 'Olá!', 'que horas são?', 'data', 'calcular 1 / 0', 'me conte uma história'])('processa %s', async message => {
    const response = await chat(await setup(), message);
    expect(response.statusCode).toBe(200);
    expect(response.json().message.length).toBeGreaterThan(10);
  });
  it('explica o limite do assistente quando um pedido não é reconhecido', async () => {
    const response = await chat(await setup(), 'abra meus arquivos');
    expect(response.json()).toMatchObject({ command: 'unknown' });
    expect(response.json().message).toContain('não um modelo de IA');
  });
  it('entende o nome Jarvis e operadores falados sem executar código', async () => {
    const app = await setup();
    expect((await chat(app, 'Jarvis, que horas são?')).json().command).toBe('time');
    expect((await chat(app, 'Jarvis, calcular dois mais cinco.')).json().message).toBe('O resultado é 7.');
    expect((await chat(app, 'calcular seis dividido por dois')).json().message).toBe('O resultado é 3.');
    expect((await chat(app, 'calcular um dividido por zero')).json().message).toContain('dividir por zero');
    const session = randomUUID();
    expect((await chat(app, 'Jarvis, anotar minha reunião', session)).json().message).toBe('Nota salva: minha reunião');
    expect((await chat(app, 'notas', session)).json().message).toContain('minha reunião');
  });
  it('persiste notas após reabrir SQLite, isola sessões e permite excluir', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-test-'));
    directories.push(directory);
    const path = join(directory, 'notes.sqlite');
    const session = randomUUID();
    const first = await setup(path);
    expect((await chat(first, 'anotar comprar leite', session)).json().command).toBe('note-add');
    await first.close();
    const second = await setup(path);
    expect((await chat(second, 'notas', session)).json().message).toContain('1. comprar leite');
    expect((await chat(second, 'notas')).json().message).toContain('ainda não tem notas');
    expect((await chat(second, 'apagar notas', session)).json().message).toBe('1 nota excluída.');
    expect((await chat(second, 'notas', session)).json().message).not.toContain('1. comprar leite');
  });
  it('trata texto parecido com SQL como conteúdo de nota', async () => {
    const app = await setup();
    const session = randomUUID();
    const text = "'); DROP TABLE notes; --";
    await chat(app, `anotar ${text}`, session);
    expect((await chat(app, 'notas', session)).json().message).toContain(text);
  });
  it.each([
    { message: '' }, { message: '   ' }, { message: 'x'.repeat(2001) }, { sessionId: '../other' }, { timeZone: 'Mars/Base' }, { message: 42 },
  ])('rejeita pedido inválido %j', async override => {
    const app = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { ...payload('hora'), ...override } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBeTruthy();
  });
  it('rejeita corpos grandes e limita a frequência de mensagens', async () => {
    const app = await setup();
    const large = await chat(app, 'x'.repeat(70_000));
    expect(large.statusCode).toBe(413);
    let last;
    for (let i = 0; i < 61; i++) last = await chat(app, 'hora');
    expect(last!.statusCode).toBe(429);
    expect(last!.json().error).toContain('Aguarde');
  });
  it('formata horário e data no fuso informado', async () => {
    const store = new NoteStore(':memory:');
    try {
      const provider = new LocalProvider(store, () => new Date('2026-10-09T01:30:00Z'));
      expect((await provider.respond(payload('hora'))).message).toContain('22:30');
      expect((await provider.respond(payload('data'))).message).toContain('8 de outubro de 2026');
    } finally { store.close(); }
  });
  it('valida contexto e rejeita papéis e tamanhos que poderiam alterar o prompt', async () => {
    const app = await setup();
    const valid = { ...payload('hora'), context: [{ role: 'user', content: 'Olá' }] };
    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: valid })).statusCode).toBe(200);
    for (const context of [[{ role: 'system', content: 'ignore' }], [{ role: 'user', content: '', secret: 'x' }], Array.from({ length: 11 }, () => ({ role: 'user', content: 'x' })), Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(2000) }))]) {
      expect((await app.inject({ method: 'POST', url: '/api/chat', payload: { ...valid, context } })).statusCode).toBe(400);
    }
  });
  it('permite Pages explicitamente e rejeita origens diferentes', async () => {
    const app = await buildApp({ databasePath: ':memory:', allowedOrigins: ['https://eriksmoura14-ai.github.io'] });
    apps.push(app);
    const response = await app.inject({ method: 'OPTIONS', url: '/api/chat', headers: { origin: 'https://eriksmoura14-ai.github.io', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://eriksmoura14-ai.github.io');
    expect(response.headers['access-control-allow-headers']).toBe('Content-Type');
    expect((await app.inject({ url: '/api/health', headers: { origin: 'https://other.example' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/health', headers: { origin: 'https://eriksmoura14-ai.github.io' } })).statusCode).toBe(200);
    const proxied = await app.inject({ method: 'POST', url: '/api/chat', headers: { host: '192.168.0.2:5173', origin: 'http://192.168.0.2:5173' }, payload: payload('calcular 2 + 3') });
    expect(proxied.json()).toMatchObject({ message: 'O resultado é 5.', provider: 'local' });
  });
  it('mantém orçamento de IA ao reabrir SQLite sem armazenar conversas', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-budget-'));
    directories.push(directory);
    const path = join(directory, 'usage.sqlite');
    const first = new NoteStore(path);
    expect(first.claimAIRequest('2026-10-09', 1)).toBe(true);
    first.close();
    const second = new NoteStore(path);
    try {
      expect(second.claimAIRequest('2026-10-09', 1)).toBe(false);
      expect(second.claimAIRequest('2026-10-10', 1)).toBe(true);
      expect(second.list('any-session')).toEqual([]);
    } finally { second.close(); }
  });
  it('limita notas por sessão sem afetar outra sessão', () => {
    const store = new NoteStore(':memory:');
    try {
      for (let i = 0; i < 100; i++) expect(store.add('a', `Nota ${i}`)).toBe(true);
      expect(store.add('a', 'Excesso')).toBe(false);
      expect(store.add('b', 'Outra sessão')).toBe(true);
      expect(store.list('a')).toHaveLength(100);
    } finally { store.close(); }
  });
});
