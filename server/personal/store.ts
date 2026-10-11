import { createHash, randomUUID } from 'node:crypto';
import { MAX_CONTEXT_MESSAGES, MAX_MESSAGE_LENGTH, type Message, type PersonalMemory, type PersonalSnapshot, type NoteRepository } from '../../shared/contracts.js';
import type { NoteStore } from '../database.js';
import { conversationContext } from '../../shared/context.js';
import { memorySlot, personalProfile, sameMemory } from '../../shared/memory.js';
import { MAX_PROJECTS, MAX_TASKS, validChange, type PersonalProject, type ProjectChange } from '../../shared/projects.js';

export class PersonalError extends Error {
  constructor(message: string, readonly statusCode = 503) { super(message); }
}
interface Document {
  history: Message[]; memories: PersonalMemory[]; notes: { content: string }[];
  generation: number; usage: { day: string; count: number };
  sessions: { hash: string; version: string; expires: number }[];
  contextHistory?: Message[];
  projects?: PersonalProject[]; projectsRevision?: number; appliedProjectProposals?: string[];
}
const empty = (): Document => ({ history: [], memories: [], notes: [], generation: 0, usage: { day: '', count: 0 }, sessions: [] });
function boundedHistory(messages: Message[]): Message[] {
  const history = messages.slice(-100).map(message => ({ ...message, content: message.content.slice(0, 6000) }));
  while (history.length && Buffer.byteLength(JSON.stringify(history), 'utf8') > 1_000_000) history.shift();
  return history;
}
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
        for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4_000_000) throw new Error('storage'); chunks.push(value); }
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
    const activeHistory = value.contextHistory ?? value.history;
    const lastSearch = [...activeHistory].reverse().find(message => message.role === 'assistant' && message.webSearch);
    const searchContext = lastSearch?.webSearch;
    const publicSearchTerms = (lastSearch?.sources ?? []).map(source => source.title + ' ' + source.snippet).join(' ').slice(0, 4500);
    return { version, context: conversationContext(activeHistory), searchContext, publicSearchTerms, snapshot: { history: value.history, memories: value.memories, notes: value.notes, generation: value.generation, storage: this.name, projects: value.projects ?? [], projectsRevision: value.projectsRevision ?? 0 } };
  }
  async snapshot(): Promise<PersonalSnapshot> { return (await this.snapshotRecord()).snapshot; }
  async applyProjectChange(change: ProjectChange, revision: number, proposal?: { id: string; generation: number }) {
    if (!validChange(change)) throw new PersonalError('Proposta de projeto inválida.', 400);
    return this.change(value => {
      if (proposal && value.appliedProjectProposals?.includes(proposal.id)) return { ok: true, alreadyApplied: true };
      if ((value.projectsRevision ?? 0) !== revision || proposal && proposal.generation !== value.generation) throw new PersonalError('Seus projetos ou memórias mudaram. Atualize o painel e peça uma nova proposta.', 409);
      const projects = value.projects ??= [];
      const now = new Date().toISOString();
      const tasks = 'tasks' in change ? change.tasks.map(task => ({ id: randomUUID(), title: task.title.trim(), ...(task.dueDate ? { dueDate: task.dueDate } : {}), status: 'pending' as const, createdAt: now })) : [];
      if (projects.reduce((count, project) => count + project.tasks.length, 0) + tasks.length > MAX_TASKS) throw new PersonalError('Limite de 200 tarefas. Não foi possível adicionar outras.', 409);
      if (change.action === 'create_project') {
        if (projects.length >= MAX_PROJECTS) throw new PersonalError('Limite de 20 projetos.', 409);
        if (projects.some(project => !project.archived && project.title.toLocaleLowerCase('pt-BR') === change.title.trim().toLocaleLowerCase('pt-BR'))) throw new PersonalError('Já existe um projeto ativo com esse nome.', 409);
        projects.push({ id: randomUUID(), title: change.title.trim(), description: change.description.trim(), archived: false, createdAt: now, updatedAt: now, tasks });
      } else {
        const project = projects.find(project => project.id === change.projectId);
        if (!project) throw new PersonalError('Esse projeto não existe mais.', 404);
        if (change.action === 'archive_project' || change.action === 'restore_project') project.archived = change.action === 'archive_project';
        else {
          if (project.archived) throw new PersonalError('Restaure o projeto antes de alterar suas tarefas.', 409);
          if (change.action === 'add_tasks') project.tasks.push(...tasks);
          else if ('taskId' in change) {
            const task = project.tasks.find(task => task.id === change.taskId);
            if (!task) throw new PersonalError('Essa tarefa não existe mais.', 404);
            task.status = change.action === 'complete_task' ? 'done' : 'pending';
            if (task.status === 'done') task.completedAt = now; else delete task.completedAt;
          }
        }
        project.updatedAt = now;
      }
      value.projectsRevision = (value.projectsRevision ?? 0) + 1;
      if (proposal) value.appliedProjectProposals = [...(value.appliedProjectProposals ?? []), proposal.id].slice(-50);
      this.resetContext(value);
      return { ok: true, alreadyApplied: false };
    });
  }
  async add(_session: string, content: string) { return this.change(value => { if (value.notes.length >= 100) return false; value.notes.push({ content }); return true; }); }
  async list(_session: string) { return (await this.snapshot()).notes; }
  async clearWithReceipt() { return this.change(value => { const count = value.notes.length; value.notes = []; this.resetContext(value); return { count, generation: value.generation }; }); }
  async clear(_session: string) { return (await this.clearWithReceipt()).count; }
  async remember(content: string) {
    content = this.memoryContent(content);
    return this.change(value => {
      const slot = memorySlot(content);
      const existing = slot ? value.memories.filter(memory => memorySlot(memory.content) === slot) : [];
      if (existing.length === 1 && sameMemory(existing[0].content, content)) return value.generation;
      if (!slot && value.memories.some(memory => sameMemory(memory.content, content))) return value.generation;
      if (existing.length) {
        value.memories = value.memories.filter(memory => memorySlot(memory.content) !== slot);
        this.resetContext(value);
      }
      if (value.memories.length >= 30) throw new PersonalError('Limite de 30 memórias. Apague uma antes de adicionar outra.', 409);
      value.memories.push({ id: existing.at(-1)?.id ?? randomUUID(), content, createdAt: existing.at(-1)?.createdAt ?? new Date().toISOString() });
      return value.generation;
    });
  }
  private memoryContent(content: string) {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 500) throw new PersonalError('Use uma memória com 1 a 500 caracteres.', 400);
    return trimmed;
  }
  private resetContext(value: Document) { value.contextHistory = []; value.generation++; }
  async saveProfile(name: string, address: string, previous: { name: string; address: string }) {
    name = name.trim(); address = address.trim();
    if ([name, address].some(value => value.length > 80 || /[\r\n]/.test(value))) throw new PersonalError('Use até 80 caracteres em cada campo do perfil, sem quebras de linha.', 400);
    return this.change(value => {
      const profile = personalProfile(value.memories);
      if (profile.name !== previous.name || profile.address !== previous.address) throw new PersonalError('Seu perfil mudou em outro aparelho. Atualize os campos antes de salvar.', 409);
      const contents = [name ? `meu nome é ${name}` : '', address ? `me chame de ${address}` : ''].filter(Boolean);
      const current = value.memories.filter(memory => memorySlot(memory.content));
      if (current.length === contents.length && contents.every(content => current.some(memory => sameMemory(memory.content, content)))) return value.generation;
      const others = value.memories.filter(memory => !memorySlot(memory.content));
      if (others.length + contents.length > 30) throw new PersonalError('Limite de 30 memórias. Apague uma antes de adicionar o perfil.', 409);
      value.memories = [...others, ...contents.map(content => {
        const existing = current.filter(memory => memorySlot(memory.content) === memorySlot(content)).at(-1);
        return { id: existing?.id ?? randomUUID(), content, createdAt: existing?.createdAt ?? new Date().toISOString() };
      })];
      this.resetContext(value);
      return value.generation;
    });
  }
  async edit(id: string, content: string, previousContent: string) {
    content = this.memoryContent(content);
    return this.change(value => {
      const memory = value.memories.find(memory => memory.id === id);
      if (!memory) throw new PersonalError('Esta memória não existe mais. Atualize a lista.', 404);
      if (memory.content !== previousContent) throw new PersonalError('Esta memória mudou em outro aparelho. Atualize a lista antes de editar.', 409);
      if (memory.content === content) return value.generation;
      const slot = memorySlot(content);
      if (value.memories.some(other => other.id !== id && (sameMemory(other.content, content) || (slot && memorySlot(other.content) === slot)))) {
        throw new PersonalError('Já existe uma memória com esse conteúdo ou campo do perfil. Edite a memória existente.', 409);
      }
      memory.content = content;
      this.resetContext(value);
      return value.generation;
    });
  }
  async forget(id: string) { return this.change(value => {
    if (!value.memories.some(memory => memory.id === id)) return value.generation;
    value.memories = value.memories.filter(memory => memory.id !== id); this.resetContext(value);
    return value.generation;
  }); }
  async forgetAll() { return this.change(value => { value.memories = []; this.resetContext(value); return value.generation; }); }
  async append(messages: Message[], generation: number) {
    return this.change(value => {
      if (generation !== value.generation) return false;
      // Keep the model's context separate so visible old conversations cannot undo forgetting.
      value.contextHistory = [...(value.contextHistory ?? value.history), ...messages].slice(-MAX_CONTEXT_MESSAGES)
        .map(({ id, role, content, createdAt, webSearch, sources }) => ({ id, role, content: content.slice(0, MAX_MESSAGE_LENGTH), createdAt, ...(webSearch ? { webSearch, sources } : {}) }));
      value.history = boundedHistory([...value.history, ...messages]);
      return true;
    });
  }
  async clearHistory() { return this.change(value => { value.history = []; this.resetContext(value); }); }
  async import(messages: Message[], notes: { content: string }[]) {
    return this.change(value => {
      const known = new Set(value.history.map(message => message.id));
      value.history = boundedHistory([...value.history, ...messages.filter(message => !known.has(message.id))].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
      // Imported conversations are visible, but must not reintroduce corrected/forgotten facts.
      if (value.contextHistory !== undefined) this.resetContext(value);
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
