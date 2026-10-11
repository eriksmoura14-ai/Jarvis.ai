import type { FastifyInstance } from 'fastify';
import type { MarkdownFile } from '../../shared/knowledge.js';
import { PersonalError, type PersonalStore } from './store.js';
import { retrieveKnowledge } from './knowledge-index.js';

export function registerKnowledgeRoutes(app: FastifyInstance, store: PersonalStore) {
  app.post<{ Body: { files: MarkdownFile[]; libraryRevision: number; replace: boolean } }>('/api/personal/knowledge/import', {
    bodyLimit: 800_000, config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, required: ['files', 'libraryRevision', 'replace'], properties: { files: { type: 'array' }, libraryRevision: { type: 'integer', minimum: 0 }, replace: { type: 'boolean' } } } },
  }, request => store.importKnowledge(request.body.files, request.body.libraryRevision, request.body.replace));
  app.get<{ Querystring: { q: string } }>('/api/personal/knowledge/search', {
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['q'], properties: { q: { type: 'string', minLength: 1, maxLength: 500 } } } },
  }, async request => ({ sources: retrieveKnowledge((await store.snapshotRecord()).knowledge, request.query.q) }));
  app.get<{ Params: { id: string } }>('/api/personal/knowledge/:id', async request => {
    const note = (await store.snapshotRecord()).knowledge.find(note => note.id === request.params.id);
    if (!note) throw new PersonalError('Esta cópia da nota foi removida. Consulte a biblioteca atual.', 404);
    return note;
  });
  app.put<{ Params: { id: string }; Body: { content: string; revision: number } }>('/api/personal/knowledge/:id', {
    bodyLimit: 350_000, schema: { body: { type: 'object', additionalProperties: false, required: ['content', 'revision'], properties: { content: { type: 'string', maxLength: 50_000 }, revision: { type: 'integer', minimum: 1 } } } },
  }, request => store.editKnowledge(request.params.id, request.body.content, request.body.revision));
  app.delete<{ Params: { id: string }; Body: { libraryRevision: number } }>('/api/personal/knowledge/:id', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['libraryRevision'], properties: { libraryRevision: { type: 'integer', minimum: 0 } } } },
  }, request => store.deleteKnowledge(request.params.id, request.body.libraryRevision));
}
