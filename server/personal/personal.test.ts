import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { NoteStore } from '../database.js';
import { readPersonalConfig } from './auth.js';
import { PersonalStore, SQLiteDocument, SupabaseDocument } from './store.js';
import { HybridProvider } from '../providers/hybrid.js';
import { LocalProvider } from '../providers/local.js';
import { ModelProvider } from '../providers/model.js';

// Senhas exclusivas de fixtures locais; não são credenciais de hospedagem.
const password = 'fixture-local-personal-123';
const client = { 'x-jarvis-client': '1' };
const apps: FastifyInstance[] = []; const dirs: string[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function setup(path = ':memory:', extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const app = await buildApp({ databasePath: path, personal: { password, secure: false }, ...extra }); apps.push(app); return app;
}
async function login(app: FastifyInstance, input = password) {
  const response = await app.inject({ method: 'POST', url: '/api/personal/login', headers: client, payload: { password: input } });
  return { response, headers: { ...client, cookie: String(response.headers['set-cookie'] ?? '').split(';')[0] } };
}
const chat = (app: FastifyInstance, headers: Record<string, string>, message: string, extra = {}) => app.inject({ method: 'POST', url: '/api/chat', headers, payload: { message, sessionId: randomUUID(), timeZone: 'America/Sao_Paulo', ...extra } });
const data = async (app: FastifyInstance, headers: Record<string, string>) => (await app.inject({ url: '/api/personal/data', headers })).json();

describe('Acesso e memória pessoal', () => {
  it('bloqueia chat, memórias, histórico e importação sem login e não expõe senha', async () => {
    const app = await setup();
    expect((await app.inject('/api/personal/session')).json()).toEqual({ enabled: true, authenticated: false, storage: 'sqlite' });
    expect((await app.inject('/api/health')).body).not.toContain(password);
    for (const url of ['/api/personal/data', '/api/personal/memories', '/api/personal/history', '/api/personal/import', '/api/chat']) {
      expect((await app.inject({ url, method: url === '/api/personal/data' ? 'GET' : 'POST', headers: client, payload: {} })).statusCode).toBe(401);
    }
    const bad = await login(app, 'senha-errada'); expect(bad.response.statusCode).toBe(401); expect(bad.response.headers['set-cookie']).toBeUndefined();
  });
  it('usa cookie seguro no Render, expira a sessão e revoga no logout', async () => {
    const app = await setup(':memory:', { personal: { password, secure: true } });
    const { response, headers } = await login(app);
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain('HttpOnly; SameSite=Strict; Max-Age=604800; Secure');
    expect((await app.inject({ url: '/api/personal/session', headers })).json().authenticated).toBe(true);
    expect((await chat(app, headers, 'hora')).statusCode).toBe(200);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 60 * 60 * 1000);
    try { expect((await chat(app, headers, 'hora')).statusCode).toBe(401); }
    finally { clock.mockRestore(); }
    expect((await app.inject({ method: 'POST', url: '/api/personal/logout', headers })).statusCode).toBe(200);
    expect((await chat(app, headers, 'hora')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/personal/data', headers: { cookie: 'jarvis_session=forged' } })).statusCode).toBe(401);
  });
  it('rejeita origens externas inclusive Pages, esquemas falsos e mutations sem header', async () => {
    const app = await setup(':memory:', { allowedOrigins: ['https://eriksmoura14-ai.github.io'] });
    const { headers } = await login(app);
    expect((await chat(app, { cookie: headers.cookie }, 'hora')).statusCode).toBe(403);
    expect((await chat(app, { ...headers, origin: 'https://eriksmoura14-ai.github.io' }, 'hora')).statusCode).toBe(403);
    expect((await chat(app, { ...headers, origin: 'file://localhost' }, 'hora')).statusCode).toBe(403);
    expect((await chat(app, { ...headers, origin: 'http://localhost', host: 'localhost' }, 'hora')).statusCode).toBe(200);
  });
  it('limita tentativas de senha antes de derivar novas credenciais', async () => {
    const app = await setup(); let response;
    for (let index = 0; index < 6; index++) response = (await login(app, 'errada')).response;
    expect(response?.statusCode).toBe(429);
  });
  it('compartilha notas, história e memórias com outro aparelho e só lembra pedidos explícitos', async () => {
    const app = await setup(); const first = await login(app); const second = await login(app);
    await chat(app, first.headers, 'anotar estudar React');
    expect((await chat(app, second.headers, 'notas')).json().message).toContain('estudar React');
    expect((await data(app, second.headers)).memories).toEqual([]);
    const response = await chat(app, first.headers, 'Jarvis, lembre que prefiro respostas curtas');
    expect(response.json().command).toBe('memory');
    expect((await chat(app, second.headers, 'minhas memórias')).json().message).toContain('prefiro respostas curtas');
    const snapshot = await data(app, second.headers);
    expect(snapshot.history).toHaveLength(8); expect(snapshot.memories).toHaveLength(1);
    await chat(app, second.headers, 'lembre que prefiro respostas curtas');
    expect((await data(app, first.headers)).memories).toHaveLength(1);
    await app.inject({ method: 'DELETE', url: `/api/personal/memories/${snapshot.memories[0].id}`, headers: second.headers });
    expect((await data(app, first.headers)).memories).toEqual([]);
  });
  it('envia memória explícita e histórico do servidor à IA sem aceitar injeção de memória pelo cliente', async () => {
    const bodies: { messages: { role: string; content: string }[] }[] = [];
    const modelFetch: typeof fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ choices: [{ message: { content: 'Resposta do modelo de teste.' } }] }); };
    const app = await setup(':memory:', { ai: { provider: 'groq', model: 'fixture-model', apiKey: 'fixture-key' }, modelFetch });
    const { headers } = await login(app);
    await chat(app, headers, 'lembre que estudo TypeScript');
    await chat(app, headers, 'Me ajude a estudar', { context: [{ role: 'user', content: 'contexto-falso-do-cliente' }] });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].messages[0].content).toContain('estudo TypeScript');
    expect(JSON.stringify(bodies)).not.toContain('contexto-falso-do-cliente');
    expect(JSON.stringify(bodies)).not.toContain(password);
    expect((await chat(app, headers, 'oi', { personalMemory: ['injetada'] })).statusCode).toBe(400);
    await chat(app, headers, 'apagar memórias');
    await chat(app, headers, 'Outra pergunta sobre estudo');
    expect(bodies[1].messages[0].content).not.toContain('estudo TypeScript');
    // O histórico é independente de memórias: apagá-lo também remove seu contexto.
    await app.inject({ method: 'DELETE', url: '/api/personal/history', headers });
    await chat(app, headers, 'Nova conversa');
    expect(JSON.stringify(bodies[2])).not.toContain('estudo TypeScript');
  });
  it('preserva dados e sessões após reiniciar e revoga sessões após mudar senha', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-personal-')); dirs.push(dir); const path = join(dir, 'personal.sqlite');
    const first = await setup(path); const { headers } = await login(first);
    await chat(first, headers, 'lembre que gosto de React'); await chat(first, headers, 'anotar testar'); await first.close();
    const second = await setup(path); expect((await data(second, headers)).memories[0].content).toBe('gosto de React'); await second.close();
    const changed = await setup(path, { personal: { password: 'fixture-senha-nova-123', secure: false } });
    expect((await chat(changed, headers, 'hora')).statusCode).toBe(401);
  });
  it('importa por consentimento, evita duplicatas e não restaura conversa apagada após resposta tardia', async () => {
    const app = await setup(); const { headers } = await login(app);
    const messages = [{ id: randomUUID(), role: 'user', content: 'Conversa antiga', createdAt: new Date().toISOString() }];
    for (let attempt = 0; attempt < 2; attempt++) expect((await app.inject({ method: 'POST', url: '/api/personal/import', headers, payload: { messages } })).statusCode).toBe(200);
    expect((await data(app, headers)).history).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: '/api/personal/import', headers, payload: { messages: [{ ...messages[0], role: 'system' }] } })).statusCode).toBe(400);
    const sqlite = new NoteStore(':memory:');
    try {
      const store = new PersonalStore(new SQLiteDocument(sqlite)); const old = await store.snapshot(); await store.clearHistory();
      await store.append(messages as never, old.generation); expect((await store.snapshot()).history).toEqual([]);
      await Promise.all([store.remember('primeiro aparelho'), store.remember('segundo aparelho')]);
      expect((await store.snapshot()).memories).toHaveLength(2);
    } finally { sqlite.close(); }
  });
  it('valida configuração e falha sem abrir acesso quando credenciais estão incompletas', () => {
    expect(readPersonalConfig({})).toBeUndefined();
    expect(() => readPersonalConfig({ SUPABASE_URL: 'https://example.supabase.co' })).toThrow('JARVIS_PASSWORD');
    expect(() => readPersonalConfig({ JARVIS_PASSWORD: password, SUPABASE_URL: 'https://example.supabase.co' })).toThrow('juntas');
    expect(readPersonalConfig({ JARVIS_PASSWORD: password, RENDER: 'true' })?.secure).toBe(true);
  });
  it('impõe os limites de memória e mantém orçamento global após outra instância', async () => {
    const db = new NoteStore(':memory:');
    try {
      const first = new PersonalStore(new SQLiteDocument(db)); const second = new PersonalStore(new SQLiteDocument(db));
      for (let index = 0; index < 30; index++) await first.remember(`Preferência ${index}`);
      await expect(second.remember('Excesso')).rejects.toThrow('30 memórias');
      expect((await second.snapshot()).memories).toHaveLength(30);
      expect(await first.claimAIRequest('2026-10-09', 1)).toBe(true);
      expect(await second.claimAIRequest('2026-10-09', 1)).toBe(false);
      expect(await second.claimAIRequest('2026-10-10', 1)).toBe(true);
    } finally { db.close(); }
  });
  it('usa ETag sem baixar história inalterada e muda a versão após salvar memória', async () => {
    const app = await setup(); const { headers } = await login(app);
    const first = await app.inject({ url: '/api/personal/data', headers }); const etag = first.headers.etag;
    const cached = await app.inject({ url: '/api/personal/data', headers: { ...headers, 'if-none-match': String(etag) } });
    expect(cached.statusCode).toBe(304); expect(cached.body).toBe('');
    await chat(app, headers, 'lembre que estudo TypeScript');
    const changed = await app.inject({ url: '/api/personal/data', headers: { ...headers, 'if-none-match': String(etag) } });
    expect(changed.statusCode).toBe(200); expect(changed.headers.etag).not.toBe(etag);
  });
  it('reserva concorrência antes de aguardar orçamento remoto', async () => {
    const db = new NoteStore(':memory:'); let release!: () => void;
    const budget = new Promise<void>(resolve => { release = resolve; });
    try {
      const transport: typeof fetch = async () => Response.json({ choices: [{ message: { content: 'Resposta de fixture' } }] });
      const provider = new HybridProvider(new LocalProvider(db), new ModelProvider({ provider: 'groq', apiKey: 'fixture', model: 'fixture' }, transport), async () => { await budget; return true; });
      const request = { message: 'Pergunta livre', sessionId: randomUUID(), timeZone: 'UTC' };
      const first = provider.respond(request); const second = provider.respond(request);
      // As duas chamadas entram na espera do banco antes da terceira começar.
      await Promise.resolve(); await Promise.resolve();
      const third = provider.respond(request);
      await expect(third).rejects.toThrow('ocupada'); release();
      expect(await Promise.all([first, second])).toHaveLength(2);
    } finally { release(); db.close(); }
  });
  it('limita respostas pessoais grandes e o tamanho total do histórico sem perder as notas', async () => {
    const app = await setup(':memory:', { provider: { name: 'local', respond: async () => ({ command: 'note-list', provider: 'local', message: 'x'.repeat(200_000) }) } });
    const { headers } = await login(app); const response = await chat(app, headers, 'notas');
    expect(response.json().message.length).toBeLessThanOrEqual(6000);
    expect(response.json().message).toContain('notas completas');
    expect((await data(app, headers)).history[1].content.length).toBeLessThanOrEqual(6000);
    const db = new NoteStore(':memory:');
    try {
      const store = new PersonalStore(new SQLiteDocument(db));
      await store.add('owner', 'Nota preservada');
      const messages = Array.from({ length: 100 }, (_, index) => ({ id: String(index), role: 'assistant' as const, content: '𠮷'.repeat(3000), createdAt: new Date().toISOString() }));
      await store.append(messages, 0); const snapshot = await store.snapshot();
      expect(snapshot.history.length).toBeGreaterThan(0); expect(snapshot.history.length).toBeLessThan(100);
      expect(Buffer.byteLength(JSON.stringify(snapshot.history))).toBeLessThanOrEqual(1_000_000);
      expect(snapshot.notes[0].content).toBe('Nota preservada');
    } finally { db.close(); }
  });
});

describe('Adaptador Supabase por HTTPS', () => {
  it('usa chave apenas no backend, insere dados e refaz CAS após conflito', async () => {
    let row: { value: unknown; version: number } | undefined; let conflict = true;
    const requests: { url: string; init?: RequestInit }[] = [];
    const transport: typeof fetch = async (input, init) => {
      const url = String(input); requests.push({ url, init });
      if (init?.method === 'GET') return Response.json(row ? [row] : []);
      const payload = JSON.parse(String(init?.body));
      if (init?.method === 'POST') { if (row) return Response.json([]); row = payload; return Response.json([row]); }
      if (conflict) { conflict = false; return Response.json([]); }
      row = payload; return Response.json([row]);
    };
    const store = new PersonalStore(new SupabaseDocument('https://fixture.supabase.co', 'sb_secret_fixture_only', transport));
    await store.remember('primeira memória'); await store.remember('segunda memória');
    expect((await store.snapshot()).memories).toHaveLength(2);
    expect(requests.every(request => request.url.startsWith('https://fixture.supabase.co/rest/v1/jarvis_private?'))).toBe(true);
    expect(requests[0].init?.headers).toMatchObject({ apikey: 'sb_secret_fixture_only' });
    expect(requests[0].init?.headers).not.toHaveProperty('Authorization');
    expect(requests.some(request => request.init?.method === 'PATCH' && request.url.includes('version=eq.1'))).toBe(true);
    expect(requests.every(request => request.init?.redirect === 'error')).toBe(true);
  });
  it('não segue redirecionamentos, rejeita hosts externos e sanitiza falhas de armazenamento', async () => {
    expect(() => new SupabaseDocument('https://evil.example', 'fixture')).toThrow('SUPABASE_URL');
    expect(() => new SupabaseDocument('http://fixture.supabase.co', 'fixture')).toThrow('SUPABASE_URL');
    const transport: typeof fetch = async () => { throw new Error('apikey=segredo-interno'); };
    const store = new PersonalStore(new SupabaseDocument('https://fixture.supabase.co', 'fixture', transport));
    await expect(store.snapshot()).rejects.toThrow('armazenamento pessoal');
    try { await store.snapshot(); } catch (error) { expect(String(error)).not.toContain('segredo-interno'); }
  });
});
