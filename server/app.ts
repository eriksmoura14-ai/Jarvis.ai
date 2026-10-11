import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import serveStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { NoteStore } from './database.js';
import { LocalProvider } from './providers/local.js';
import { HybridProvider } from './providers/hybrid.js';
import { ModelError, ModelProvider, type AIConfig } from './providers/model.js';
import { ResearchProvider } from './providers/research.js';
import { SearchError, WebSearch } from './search.js';
import type { AssistantProvider } from './providers/types.js';
import { MAX_CONTEXT_CHARACTERS, MAX_CONTEXT_MESSAGES, MAX_MESSAGE_LENGTH, type ChatRequest, type ChatResponse, type Message, type ChatStreamEvent } from '../shared/contracts.js';
import { validSources, validSearchInfo } from '../shared/search.js';
import { PersonalAuth, type PersonalConfig } from './personal/auth.js';
import { PersonalError, PersonalStore, SQLiteDocument, SupabaseDocument, type DocumentBackend } from './personal/store.js';
import { memoryCommand } from './personal/commands.js';
import { SpeechError, SpeechProvider, type SpeechConfig } from './speech.js';
import { MAX_SPEECH_CHARACTERS } from '../shared/speech.js';
import { selectedNotes, selectedProjects, validatedProjectChange } from './interpretation.js';
import { ProjectProposals, registerProjectRoutes, projectCommand } from './personal/projects.js';
import { registerObsidianRoutes } from './personal/obsidian.js';
import { registerKnowledgeRoutes } from './personal/knowledge.js';
import { retrieveKnowledge, knowledgeReply, knowledgeCatalog, readKnowledge } from './personal/knowledge-index.js';
import { resolveConversation } from './conversation.js';
import type { AssistantInput } from './interpretation.js';

interface AppOptions {
  databasePath?: string; provider?: AssistantProvider; logger?: boolean; serveWeb?: boolean;
  ai?: AIConfig; modelFetch?: typeof fetch; aiDailyLimit?: number; allowedOrigins?: string[];
  searchFetch?: typeof fetch;
  personal?: PersonalConfig; personalBackend?: DocumentBackend;
  speech?: SpeechConfig; speechFetch?: typeof fetch;
}
export async function buildApp(options: AppOptions = {}) {
  if (options.speech && !options.personal) throw new Error('A voz por IA exige o modo pessoal com senha.');
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
  const projectProposals = new ProjectProposals();
  const local = new LocalProvider(personal ?? store);
  const provider = options.provider ?? (options.ai ? new HybridProvider(local, new ModelProvider(options.ai, options.modelFetch), day => (personal ?? store).claimAIRequest(day, dailyLimit)) : local);
  const assistant = new ResearchProvider(provider, new WebSearch(options.searchFetch));
  const speech = options.speech ? new SpeechProvider(options.speech, options.speechFetch) : undefined;
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
    if (path === '/api/obsidian/sync') {
      if (!auth || !await auth.obsidianAuthenticated(request)) return reply.code(401).send({ error: 'Chave do Obsidian inválida, expirada ou revogada. Gere outra no JARVIS.' });
      return;
    }
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
    return { status: 'ok', provider: provider.name, version: '0.1.0', streaming: true, webSearch: { enabled: true },
      ...(personal ? { projects: { enabled: true }, knowledge: { enabled: true }, obsidian: { enabled: true, protocol: 1 } } : {}),
      ...(provider instanceof HybridProvider ? { interpretation: { enabled: true } } : {}),
      ...(speech ? { speech: { configured: true, provider: 'elevenlabs' } } : {}),
      ...(revision && /^[0-9a-f]{40}$/i.test(revision) ? { revision } : {}),
      ...(provider instanceof HybridProvider ? { ai: { configured: true, provider: provider.name, model: provider.model.config.model } } : {}) };
  });
  app.post<{ Body: { text: string } }>('/api/speech', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['text'], properties: {
      text: { type: 'string', minLength: 1, maxLength: MAX_SPEECH_CHARACTERS },
    } } },
  }, async (request, reply) => {
    if (!speech) throw new SpeechError('A voz por IA ainda não está configurada. Use a voz do aparelho.');
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on('close', disconnected);
    try { return reply.type('audio/mpeg').send(await speech.synthesize(request.body.text, controller.signal)); }
    finally { reply.raw.removeListener('close', disconnected); }
  });
  app.get('/api/personal/session', async request => personal && auth
    ? { enabled: true, authenticated: await auth.authenticated(request), storage: personal.name } : { enabled: false });
  if (personal && auth) {
    registerProjectRoutes(app, personal, projectProposals);
    registerKnowledgeRoutes(app, personal);
    registerObsidianRoutes(app, personal, auth);
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
    app.patch<{ Params: { id: string }; Body: { content: string; previousContent: string } }>('/api/personal/memories/:id', {
      schema: { body: { type: 'object', additionalProperties: false, required: ['content', 'previousContent'], properties: {
        content: { type: 'string', minLength: 1, maxLength: 500 }, previousContent: { type: 'string', minLength: 1, maxLength: 500 },
      } } },
    }, async request => { await personal.edit(request.params.id, request.body.content, request.body.previousContent); return { ok: true }; });
    app.put<{ Body: { name: string; address: string; previousName: string; previousAddress: string } }>('/api/personal/profile', {
      schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'address', 'previousName', 'previousAddress'], properties: {
        name: { type: 'string', maxLength: 80 }, address: { type: 'string', maxLength: 80 },
        previousName: { type: 'string', maxLength: 80 }, previousAddress: { type: 'string', maxLength: 80 },
      } } },
    }, async request => { const { name, address, previousName, previousAddress } = request.body; await personal.saveProfile(name, address, { name: previousName, address: previousAddress }); return { ok: true }; });
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
          webSearch: { type: 'boolean' }, stream: { type: 'boolean' }, voice: { type: 'boolean' },
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
    const started = performance.now();
    const deadline = setTimeout(() => controller.abort(), 42_000);
    reply.raw.once('finish', () => clearTimeout(deadline));
    reply.raw.once('close', () => clearTimeout(deadline));
    let firstTextMs: number | undefined;
    const respond = async (emit?: (event: ChatStreamEvent) => void) => {
      controller.signal.throwIfAborted();
      const command = personal ? await memoryCommand(request.body, personal) : undefined;
      const record = personal ? await personal.snapshotRecord() : undefined;
      controller.signal.throwIfAborted();
      const snapshot = record?.snapshot;
      const resolution = resolveConversation(record?.context ?? request.body.context ?? [], request.body.message, record?.lastAnswerFromKnowledge);
      let knowledgeContext = record ? retrieveKnowledge(record.knowledge, resolution.query) : [];
      const body: AssistantInput = record ? { ...request.body, sessionId: 'owner', context: record.context, searchContext: record.searchContext, publicSearchTerms: record.publicSearchTerms,
        personalMemory: record.snapshot.memories.map(memory => memory.content), personalNotes: selectedNotes(record.snapshot.notes, resolution.query),
        projectData: selectedProjects(record.snapshot.projects ?? [], resolution.query), privateProjectTerms: JSON.stringify(record.snapshot.projects ?? []),
        knowledgeContext, knowledgeCatalog: knowledgeCatalog(record.knowledge, resolution.query), knowledgeCount: record.knowledge.length,
        readKnowledge: plan => { controller.signal.throwIfAborted(); knowledgeContext = readKnowledge(record.knowledge, plan); return knowledgeContext; },
        privateKnowledgeTerms: record.knowledge.map(note => note.path + ' ' + note.content).join('\n'), knowledgeOnly: resolution.knowledgeOnly, privateOnly: resolution.privateOnly, conversationSubject: resolution.subject }
        : { ...request.body, privateOnly: resolution.privateOnly, conversationSubject: resolution.subject };
      const prepared = performance.now();
      let lastEmit = -Infinity;
      const progress = emit ? (text: string) => {
        controller.signal.throwIfAborted();
        firstTextMs ??= Math.round(performance.now() - started);
        // Snapshots allow research fallback to replace a failed partial summary.
        if (performance.now() - lastEmit >= 80) { lastEmit = performance.now(); emit({ type: 'text', text: text.slice(0, 6000) }); }
      } : undefined;
      const raw = command?.response ?? (snapshot ? projectCommand(request.body, snapshot, provider.name !== 'local') : undefined)
        ?? (resolution.clarification ? { message: resolution.clarification, command: 'conversation' as const, provider: 'local' as const } : undefined)
        ?? (record ? knowledgeReply(request.body.message, record.knowledge, knowledgeContext, provider.name !== 'local') : undefined)
        ?? (record && resolution.knowledgeOnly ? knowledgeReply(resolution.query, record.knowledge, knowledgeContext, provider.name !== 'local') : undefined)
        ?? await assistant.respond(body, controller.signal, progress);
      const { proposal: _proposal, knowledgeSources: _knowledgeSources, ...safe } = raw;
      const change = 'projectChange' in raw ? validatedProjectChange(raw.projectChange, body) : undefined;
      if ('projectChange' in safe) delete safe.projectChange;
      const noteSources = knowledgeContext.length && (raw.provider !== 'local' || raw.command === 'knowledge') ? knowledgeContext : undefined;
      const response: ChatResponse = { ...safe, message: safe.message.replace(/\[N\d+\]/g, reference => noteSources?.some(source => `[${source.reference}]` === reference) ? reference : ''), id: randomUUID(), createdAt: new Date().toISOString(), ...(noteSources ? { knowledgeSources: noteSources } : {}), ...(change && snapshot ? { proposal: projectProposals.create(change, snapshot) } : {}) };
      controller.signal.throwIfAborted();
      const answered = performance.now();
      if (personal && snapshot) {
        if (response.message.length > 6000) response.message = response.message.slice(0, 5800) + (response.command === 'note-list'
          ? '\n\nLista limitada. Consulte as notas completas em Preferências → Memória pessoal.' : '\n\nTexto limitado a 6000 caracteres.');
        const appended = await personal.append([{ id: randomUUID(), role: 'user', content: request.body.message, createdAt: response.createdAt },
          { id: response.id, role: 'assistant', content: response.message, createdAt: response.createdAt, provider: response.provider,
            ...(response.sources ? { sources: response.sources } : {}), ...(response.webSearch ? { webSearch: response.webSearch } : {}), ...(response.knowledgeSources ? { knowledgeSources: response.knowledgeSources } : {}) }], command?.generation ?? snapshot.generation);
        if (!appended) throw new PersonalError('Sua memória ou conversa mudou enquanto eu respondia. Envie a pergunta novamente para usar o contexto atualizado.', 409);
      }
      response.timings = { preparationMs: Math.round(prepared - started), answerMs: Math.round(answered - prepared),
        saveMs: Math.round(performance.now() - answered), totalMs: Math.round(performance.now() - started),
        ...(firstTextMs !== undefined ? { firstTextMs } : {}) };
      return response;
    };
    if (!request.body.stream) {
      try { return await respond(); }
      finally { reply.raw.removeListener('close', disconnected); }
    }
    const output = new PassThrough({ highWaterMark: 64_000 });
    let bytes = 0;
    const emit = (event: ChatStreamEvent) => {
      if (controller.signal.aborted || output.destroyed) return;
      const line = JSON.stringify(event) + '\n';
      // Leave room for the final result. A slow reader cannot build an unbounded queue.
      if (event.type === 'text' && bytes + Buffer.byteLength(line) > 600_000) return;
      bytes += Buffer.byteLength(line);
      if (!output.write(line)) controller.abort();
    };
    reply.type('application/x-ndjson; charset=utf-8').header('X-Accel-Buffering', 'no');
    emit({ type: 'ready' });
    void respond(emit).then(response => emit({ type: 'result', response })).catch(error => {
      if (controller.signal.aborted) return;
      const known = error instanceof ModelError || error instanceof SearchError || error instanceof PersonalError;
      if (!known) request.log.error(error);
      emit({ type: 'error', error: known ? error.message : 'O assistente encontrou um erro. Tente novamente.' });
    }).finally(() => {
      output.end();
      reply.raw.removeListener('close', disconnected);
    });
    return reply.send(output);
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ModelError || error instanceof SearchError || error instanceof PersonalError || error instanceof SpeechError) return reply.code(error.statusCode).send({ error: error.message });
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
