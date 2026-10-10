import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import serveStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NoteStore } from './database.js';
import { LocalProvider } from './providers/local.js';
import { HybridProvider } from './providers/hybrid.js';
import { ModelError, ModelProvider, type AIConfig } from './providers/model.js';
import { ResearchProvider } from './providers/research.js';
import { SearchError, WebSearch } from './search.js';
import type { AssistantProvider } from './providers/types.js';
import { MAX_CONTEXT_CHARACTERS, MAX_CONTEXT_MESSAGES, MAX_MESSAGE_LENGTH, type ChatRequest, type ChatResponse, type Message } from '../shared/contracts.js';
import { conversationContext } from '../shared/context.js';
import { validSources, validSearchInfo } from '../shared/search.js';
import { PersonalAuth, type PersonalConfig } from './personal/auth.js';
import { PersonalError, PersonalStore, SQLiteDocument, SupabaseDocument, type DocumentBackend } from './personal/store.js';
import { memoryCommand } from './personal/commands.js';

interface AppOptions {
  databasePath?: string; provider?: AssistantProvider; logger?: boolean; serveWeb?: boolean;
  ai?: AIConfig; modelFetch?: typeof fetch; aiDailyLimit?: number; allowedOrigins?: string[];
  searchFetch?: typeof fetch;
  personal?: PersonalConfig; personalBackend?: DocumentBackend;
}
export async function buildApp(options: AppOptions = {}) {
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map(value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) throw new Error('ALLOWED_ORIGINS deve conter origens completas, sem caminho ou barra final.');
    return value;
  }));
  const dailyLimit = options.aiDailyLimit ?? 100;
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) throw new Error('AI_DAILY_LIMIT deve ser um inteiro entre 1 e 1000.');
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 65_536, ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  const store = new NoteStore(options.databasePath ?? process.env.DATABASE_PATH ?? './data/jarvis.sqlite');
  const personal = options.personal ? new PersonalStore(options.personalBackend ?? (options.personal.supabase
    ? new SupabaseDocument(options.personal.supabase.url, options.personal.supabase.key) : new SQLiteDocument(store))) : undefined;
  const auth = options.personal && personal ? new PersonalAuth(options.personal, personal) : undefined;
  const local = new LocalProvider(personal ?? store);
  const provider = options.provider ?? (options.ai ? new HybridProvider(local, new ModelProvider(options.ai, options.modelFetch), day => (personal ?? store).claimAIRequest(day, dailyLimit)) : local);
  const assistant = new ResearchProvider(provider, new WebSearch(options.searchFetch));
  app.addHook('onClose', async () => store.close());
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    let sameHost = false;
    try { if (origin) { const url = new URL(origin); sameHost = url.host === request.headers.host && ['http:', 'https:'].includes(url.protocol) && (!options.personal?.secure || url.protocol === 'https:'); } } catch { /* Reject malformed origins. */ }
    if (origin && !sameHost && (auth || !allowedOrigins.has(origin))) return reply.code(403).send({ error: auth ? 'Use o endereço do próprio JARVIS para acessar sua conta.' : 'Este site não está autorizado pelo backend. Confira ALLOWED_ORIGINS.' });
    if (origin && !auth && allowedOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
    }
    if (auth && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers['x-jarvis-client'] !== '1') return reply.code(403).send({ error: 'Pedido sem proteção de origem. Reabra o JARVIS.' });
    const path = request.url.split('?')[0];
    if (auth && !['/api/health', '/api/personal/session', '/api/personal/login'].includes(path) && !await auth.authenticated(request)) return reply.code(401).send({ error: 'Sua sessão expirou. Entre novamente.' });
  });
  app.options('/api/chat', async (_request, reply) => reply
    .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    .header('Access-Control-Allow-Headers', 'Content-Type')
    .header('Access-Control-Max-Age', '600').code(204).send());
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'microphone=(self), camera=()');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  });
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const revision = process.env.RENDER_GIT_COMMIT;
    return { status: 'ok', provider: provider.name, version: '0.1.0', webSearch: { enabled: true },
      ...(revision && /^[0-9a-f]{40}$/i.test(revision) ? { revision } : {}),
      ...(provider instanceof HybridProvider ? { ai: { configured: true, provider: provider.name, model: provider.model.config.model } } : {}) };
  });
  app.get('/api/personal/session', async request => personal && auth
    ? { enabled: true, authenticated: await auth.authenticated(request), storage: personal.name } : { enabled: false });
  if (personal && auth) {
    app.post<{ Body: { password: string } }>('/api/personal/login', {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { body: { type: 'object', additionalProperties: false, required: ['password'], properties: { password: { type: 'string', minLength: 1, maxLength: 200 } } } },
    }, async (request, reply) => {
      if (!await auth.login(request.body.password, reply)) return reply.code(401).send({ error: 'Senha incorreta.' });
      return { ok: true };
    });
    app.post('/api/personal/logout', async (request, reply) => { await auth.logout(request, reply); return { ok: true }; });
    app.get('/api/personal/data', async (request, reply) => {
      if (request.headers['if-none-match'] && request.headers['if-none-match'] === `"personal-${await personal.revision()}"`) return reply.code(304).send();
      const data = await personal.snapshotRecord();
      reply.header('ETag', `"personal-${data.version}"`);
      return data.snapshot;
    });
    app.delete('/api/personal/history', async () => { await personal.clearHistory(); return { ok: true }; });
    app.post<{ Body: { content: string } }>('/api/personal/memories', {
      schema: { body: { type: 'object', additionalProperties: false, required: ['content'], properties: { content: { type: 'string', minLength: 1, maxLength: 500 } } } },
    }, async (request, reply) => { if (!request.body.content.trim()) return reply.code(400).send({ error: 'Digite uma memória.' }); await personal.remember(request.body.content.trim()); return { ok: true }; });
    app.delete<{ Params: { id: string } }>('/api/personal/memories/:id', async request => { await personal.forget(request.params.id); return { ok: true }; });
    app.delete('/api/personal/memories', async () => { await personal.forgetAll(); return { ok: true }; });
    app.post<{ Body: { messages: Message[]; legacySessionId?: string } }>('/api/personal/import', {
      bodyLimit: 1_500_000, schema: { body: { type: 'object', additionalProperties: false, required: ['messages'], properties: {
        messages: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['id', 'role', 'content', 'createdAt'], properties: {
          id: { type: 'string', minLength: 1, maxLength: 100 }, role: { enum: ['user', 'assistant'] },
          content: { type: 'string', minLength: 1, maxLength: 6000 }, createdAt: { type: 'string', maxLength: 50 },
          provider: { enum: ['local', 'groq', 'ollama'] }, sources: { type: 'array', maxItems: 5 }, webSearch: { type: 'object' },
        } } }, legacySessionId: { type: 'string', pattern: '^[a-fA-F0-9-]{36}$' },
      } } },
    }, async (request, reply) => {
      const messages = request.body.messages;
      if (messages.some(message => !Number.isFinite(Date.parse(message.createdAt)) || (message.sources !== undefined && !validSources(message.sources)) || (message.webSearch !== undefined && !validSearchInfo(message.webSearch)))) return reply.code(400).send({ error: 'O histórico antigo contém dados inválidos.' });
      await personal.import(messages.filter(message => message.id !== 'welcome'), request.body.legacySessionId ? store.list(request.body.legacySessionId) : []);
      return { ok: true };
    });
  }
  app.post<{ Body: ChatRequest }>('/api/chat', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['message', 'sessionId', 'timeZone'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
          webSearch: { type: 'boolean' },
          sessionId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' },
          timeZone: { type: 'string', minLength: 1, maxLength: 100 },
          context: { type: 'array', maxItems: MAX_CONTEXT_MESSAGES, items: {
            type: 'object', additionalProperties: false, required: ['role', 'content'], properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
            },
          } },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.body.message.trim()) return reply.code(400).send({ error: 'Digite uma mensagem.' });
    if ((request.body.context ?? []).reduce((length, entry) => length + entry.content.length, 0) > MAX_CONTEXT_CHARACTERS) return reply.code(400).send({ error: 'O contexto da conversa excedeu o limite.' });
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: request.body.timeZone }).format(); }
    catch { return reply.code(400).send({ error: 'Fuso horário inválido.' }); }
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on('close', disconnected);
    try {
      const snapshot = personal ? await personal.snapshot() : undefined;
      const body = snapshot ? { ...request.body, sessionId: 'owner', context: conversationContext(snapshot.history), personalMemory: snapshot.memories.map(memory => memory.content) } : request.body;
      const command = personal && !request.body.webSearch ? await memoryCommand(body, personal) : undefined;
      const response: ChatResponse = { ...(command ?? await assistant.respond(body, controller.signal)), id: randomUUID(), createdAt: new Date().toISOString() };
      if (personal && snapshot) {
        if (response.message.length > 6000) response.message = response.message.slice(0, 5800) + (response.command === 'note-list'
          ? '\n\nLista limitada. Consulte as notas completas em Preferências → Memória pessoal.' : '\n\nTexto limitado a 6000 caracteres.');
        await personal.append([{ id: randomUUID(), role: 'user', content: request.body.message, createdAt: response.createdAt },
          { id: response.id, role: 'assistant', content: response.message, createdAt: response.createdAt, provider: response.provider,
            ...(response.sources ? { sources: response.sources } : {}), ...(response.webSearch ? { webSearch: response.webSearch } : {}) }], snapshot.generation);
      }
      reply.header('Cache-Control', 'no-store');
      return response;
    } finally { reply.raw.removeListener('close', disconnected); }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ModelError || error instanceof SearchError || error instanceof PersonalError) return reply.code(error.statusCode).send({ error: error.message });
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) request.log.error(error);
    reply.code(status).send({ error: status === 429 ? 'Muitas mensagens. Aguarde um minuto e tente novamente.' : status < 500 ? 'Pedido inválido. Confira a mensagem e tente novamente.' : 'O assistente encontrou um erro. Tente novamente.' });
  });
  const webRoot = resolve('dist');
  if (options.serveWeb && existsSync(resolve(webRoot, 'index.html'))) {
    await app.register(serveStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/')
      ? reply.code(404).send({ error: 'Rota não encontrada.' })
      : reply.sendFile('index.html'));
  }
  return app;
}
