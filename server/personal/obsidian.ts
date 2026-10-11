import type { FastifyInstance } from 'fastify';
import type { SyncRequest } from '../../shared/obsidian.js';
import { PersonalError, type PersonalStore } from './store.js';
import type { PersonalAuth } from './auth.js';
export function registerObsidianRoutes(app: FastifyInstance, store: PersonalStore, auth: PersonalAuth) {
  app.get('/api/personal/obsidian/devices', async () => ({ devices: await auth.listObsidianDevices() }));
  app.post<{ Body: { name: string } }>('/api/personal/obsidian/devices', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 60, pattern: '^[^\\u0000-\\u001f\\u007f]+$' } } } },
  }, request => { if (!request.body.name.trim()) throw new PersonalError('Dê um nome ao aparelho.', 400); return auth.createObsidianDevice(request.body.name); });
  app.delete<{ Params: { id: string } }>('/api/personal/obsidian/devices/:id', request => store.revokeObsidianDevice(request.params.id));
  app.post<{ Body: SyncRequest }>('/api/obsidian/sync', {
    bodyLimit: 800_000, config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, request => store.syncKnowledge(request.body));
}
