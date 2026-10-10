import { createHash, randomUUID } from 'node:crypto';
import type { Message, PersonalMemory, PersonalSnapshot, NoteRepository } from '../../shared/contracts.js';
import type { NoteStore } from '../database.js';

export class PersonalError extends Error {
  constructor(message: string, readonly statusCode = 503) { super(message); }
}
interface Document {
  history: Message[]; memories: PersonalMemory[]; notes: { content: string }[];
  generation: number; usage: { day: string; count: number };
  sessions: { hash: string; version: string; expires: number }[];
}
const empty = (): Document => ({ history: [], memories: [], notes: [], generation: 0, usage: { day: '', count: 0 }, sessions: [] });
export interface DocumentBackend {
  readonly name: 'sqlite' | 'supabase';
  read(key?: 'owner' | 'sessions'): Promise<{ value: Document; version: number }>;
  write(value: Document, version: number, key?: 'owner' | 'sessions'): Promise<boolean>;
  revision?(): Promise<number>;
}
export class SQLiteDocument implements DocumentBackend {
  readonly name = 'sqlite';
  constructor(private store: NoteStore) {}
  async read(key: 'owner' | 'sessions' = 'owner') { const row = this.store.readDocument(key); return row ? { value: JSON.parse(row.value) as Document, version: row.version } : { value: empty(), version: 0 }; }
  async write(value: Document, version: number, key: 'owner' | 'sessions' = 'owner') { return this.store.writeDocument(JSON.stringify(value), version, key); }
}
export class SupabaseDocument implements DocumentBackend {
  readonly name = 'supabase';
  private endpoint: string;
  constructor(url: string, private key: string, private transport: typeof fetch = fetch) {
    const origin = new URL(url);
    if (origin.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname) || origin.port || origin.username || origin.password || origin.search || origin.hash || !['', '/'].includes(origin.pathname)) throw new Error('SUPABASE_URL deve ser a URL HTTPS do projeto Supabase, sem caminho.');
    this.endpoint = `${origin.origin}/rest/v1/jarvis_private`;
  }
  private async request(path: string, method = 'GET', body?: unknown, prefer?: string): Promise<unknown[]> {
    try {
      const response = await this.transport(this.endpoint + path, { method, redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { apikey: this.key, ...(this.key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${this.key}` }),
          'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) { await response.body?.cancel(); throw new Error('storage'); }
      if (!response.body) throw new Error('storage');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2_000_000) throw new Error('storage'); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(data)) throw new Error('storage');
      return data;
    } catch { throw new PersonalError('Não foi possível acessar seu armazenamento pessoal. Confira o projeto, a tabela e as variáveis do Supabase no Render.'); }
  }
  async read(key: 'owner' | 'sessions' = 'owner') {
    const rows = await this.request(`?id=eq.${key}&select=value,version`);
    if (!rows.length) return { value: empty(), version: 0 };
    const row = rows[0] as { value: Document; version: number };
    if (!Number.isSafeInteger(row.version) || row.version < 1 || !row.value || !Array.isArray(row.value.history) || !Array.isArray(row.value.sessions)) throw new PersonalError('Os dados pessoais armazenados têm formato inválido.');
    return row;
  }
  async revision() {
    const rows = await this.request('?id=eq.owner&select=version');
    const version = (rows[0] as { version?: number } | undefined)?.version ?? 0;
    if (!Number.isSafeInteger(version) || version < 0) throw new PersonalError('Versão de dados inválida.');
    return version;
  }
  async write(value: Document, version: number, key: 'owner' | 'sessions' = 'owner') {
    const rows = version === 0
      ? await this.request('?on_conflict=id', 'POST', { id: key, value, version: 1 }, 'resolution=ignore-duplicates,return=representation')
      : await this.request(`?id=eq.${key}&version=eq.${version}`, 'PATCH', { value, version: version + 1 }, 'return=representation');
    return rows.length === 1;
  }
}
export class PersonalStore implements NoteRepository {
  constructor(private backend: DocumentBackend) {}
  get name() { return this.backend.name; }
  private async change<T>(update: (value: Document) => T, key: 'owner' | 'sessions' = 'owner'): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = await this.backend.read(key); const result = update(row.value);
      if (await this.backend.write(row.value, row.version, key)) return result;
    }
    throw new PersonalError('Outro aparelho atualizou seus dados ao mesmo tempo. Tente novamente.', 409);
  }
  async revision() { return this.backend.revision ? this.backend.revision() : (await this.backend.read()).version; }
  async snapshotRecord() {
    const { value, version } = await this.backend.read();
    return { version, snapshot: { history: value.history, memories: value.memories, notes: value.notes, generation: value.generation, storage: this.name } };
  }
  async snapshot(): Promise<PersonalSnapshot> { return (await this.snapshotRecord()).snapshot; }
  async add(_session: string, content: string) { return this.change(value => { if (value.notes.length >= 100) return false; value.notes.push({ content }); return true; }); }
  async list(_session: string) { return (await this.snapshot()).notes; }
  async clear(_session: string) { return this.change(value => { const count = value.notes.length; value.notes = []; return count; }); }
  async remember(content: string) {
    return this.change(value => {
      if (value.memories.some(memory => memory.content === content)) return;
      if (value.memories.length >= 30) throw new PersonalError('Limite de 30 memórias. Apague uma antes de adicionar outra.', 409);
      value.memories.push({ id: randomUUID(), content, createdAt: new Date().toISOString() });
    });
  }
  async forget(id: string) { return this.change(value => { value.memories = value.memories.filter(memory => memory.id !== id); }); }
  async forgetAll() { return this.change(value => { value.memories = []; }); }
  async append(messages: Message[], generation: number) {
    return this.change(value => { if (generation !== value.generation) return; value.history = [...value.history, ...messages].slice(-100); });
  }
  async clearHistory() { return this.change(value => { value.history = []; value.generation++; }); }
  async import(messages: Message[], notes: { content: string }[]) {
    return this.change(value => {
      const known = new Set(value.history.map(message => message.id));
      value.history = [...value.history, ...messages.filter(message => !known.has(message.id))].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(-100);
      value.notes = [...value.notes, ...notes.filter(note => !value.notes.some(existing => existing.content === note.content))].slice(-100);
    });
  }
  async claimAIRequest(day: string, limit: number) {
    return this.change(value => { if (value.usage.day !== day) value.usage = { day, count: 0 }; if (value.usage.count >= limit) return false; value.usage.count++; return true; });
  }
  async addSession(hash: string, version: string, expires: number) {
    return this.change(value => { value.sessions = value.sessions.filter(session => session.expires > Date.now() && session.version === version).slice(-19); value.sessions.push({ hash, version, expires }); }, 'sessions');
  }
  async validSession(hash: string, version: string) { return (await this.backend.read('sessions')).value.sessions.some(session => session.hash === hash && session.version === version && session.expires > Date.now()); }
  async removeSession(hash: string) { return this.change(value => { value.sessions = value.sessions.filter(session => session.hash !== hash); }, 'sessions'); }
}
export const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
