import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import serveStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NoteStore } from './database.js';
import { LocalProvider } from './providers/local.js';
import type { AssistantProvider } from './providers/types.js';
import { MAX_MESSAGE_LENGTH, type ChatRequest, type ChatResponse } from '../shared/contracts.js';

interface AppOptions { databasePath?: string; provider?: AssistantProvider; logger?: boolean; serveWeb?: boolean }
export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16_384, ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  const store = new NoteStore(options.databasePath ?? process.env.DATABASE_PATH ?? './data/jarvis.sqlite');
  const provider = options.provider ?? new LocalProvider(store);
  app.addHook('onClose', async () => store.close());
  await app.register(rateLimit, { global: false });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'microphone=(self), camera=()');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  });
  app.get('/api/health', async () => ({ status: 'ok', provider: provider.name, version: '0.1.0' }));
  app.post<{ Body: ChatRequest }>('/api/chat', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['message', 'sessionId', 'timeZone'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
          sessionId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' },
          timeZone: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.body.message.trim()) return reply.code(400).send({ error: 'Digite uma mensagem.' });
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: request.body.timeZone }).format(); }
    catch { return reply.code(400).send({ error: 'Fuso horário inválido.' }); }
    const response: ChatResponse = { ...await provider.respond(request.body), id: randomUUID(), createdAt: new Date().toISOString() };
    reply.header('Cache-Control', 'no-store');
    return response;
  });
  app.setErrorHandler((error, request, reply) => {
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
