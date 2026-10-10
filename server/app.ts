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
import { MAX_CONTEXT_CHARACTERS, MAX_CONTEXT_MESSAGES, MAX_MESSAGE_LENGTH, type ChatRequest, type ChatResponse } from '../shared/contracts.js';

interface AppOptions {
  databasePath?: string; provider?: AssistantProvider; logger?: boolean; serveWeb?: boolean;
  ai?: AIConfig; modelFetch?: typeof fetch; aiDailyLimit?: number; allowedOrigins?: string[];
  searchFetch?: typeof fetch;
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
  const local = new LocalProvider(store);
  const provider = options.provider ?? (options.ai ? new HybridProvider(local, new ModelProvider(options.ai, options.modelFetch), day => store.claimAIRequest(day, dailyLimit)) : local);
  const assistant = new ResearchProvider(provider, new WebSearch(options.searchFetch));
  app.addHook('onClose', async () => store.close());
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !request.url.startsWith('/api/')) return;
    let sameHost = false;
    try { sameHost = new URL(origin).host === request.headers.host; } catch { /* Reject malformed origins. */ }
    if (!sameHost && !allowedOrigins.has(origin)) return reply.code(403).send({ error: 'Este site não está autorizado pelo backend. Confira ALLOWED_ORIGINS.' });
    if (allowedOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
    }
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
      const response: ChatResponse = { ...await assistant.respond(request.body, controller.signal), id: randomUUID(), createdAt: new Date().toISOString() };
      reply.header('Cache-Control', 'no-store');
      return response;
    } finally { reply.raw.removeListener('close', disconnected); }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ModelError || error instanceof SearchError) return reply.code(error.statusCode).send({ error: error.message });
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
