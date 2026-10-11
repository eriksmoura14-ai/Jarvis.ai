import { createHash, randomUUID } from 'node:crypto';
import { MAX_CONTEXT_MESSAGES, MAX_MESSAGE_LENGTH, type Message, type PersonalMemory, type PersonalSnapshot, type NoteRepository } from '../../shared/contracts.js';
import type { NoteStore } from '../database.js';
import { conversationContext } from '../../shared/context.js';
import { memorySlot, personalProfile, sameMemory } from '../../shared/memory.js';
import { MAX_PROJECTS, MAX_TASKS, validChange, type PersonalProject, type ProjectChange } from '../../shared/projects.js';
import { MAX_KNOWLEDGE_NOTES, MAX_LIBRARY_BYTES, KNOWLEDGE_CAPACITY_LABEL, MAX_IMPORT_FILES, validMarkdownFiles, byteLength, pathKey, type KnowledgeNote, type MarkdownFile } from '../../shared/knowledge.js';
import { markdownTitle } from './knowledge-index.js';
import { normalizeMarkdown, validSyncRequest, type SyncRequest, type SyncResponse, type ObsidianDevice } from '../../shared/obsidian.js';

export class PersonalError extends Error {
  constructor(message: string, readonly statusCode = 503) { super(message); }
}
// 10 MB of note text can grow when JSON-escaped; also allow note metadata,
// history, memories and projects in the same existing private document.
export const MAX_PERSONAL_DOCUMENT_BYTES = 32_000_000;
interface Document {
  history: Message[]; memories: PersonalMemory[]; notes: { content: string }[];
  generation: number; usage: { day: string; count: number };
  sessions: { hash: string; version: string; expires: number }[];
  contextHistory?: Message[];
  projects?: PersonalProject[]; projectsRevision?: number; appliedProjectProposals?: string[];
  knowledge?: KnowledgeNote[]; libraryRevision?: number;
  obsidianDevices?: (ObsidianDevice & { hash: string; version: string })[];
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
      const serialized = body ? JSON.stringify(body) : undefined;
      if (serialized && Buffer.byteLength(serialized, 'utf8') > MAX_PERSONAL_DOCUMENT_BYTES) throw new Error('storage');
      const response = await this.transport(this.endpoint + path, { method, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { apikey: this.key, ...(this.key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${this.key}` }),
          'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, ...(serialized ? { body: serialized } : {}) });
      if (!response.ok) { await response.body?.cancel(); throw new Error('storage'); }
      if (!response.body) throw new Error('storage');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_PERSONAL_DOCUMENT_BYTES) throw new Error('storage'); chunks.push(value); }
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
      ? await this.request('?on_conflict=id&select=version', 'POST', { id: key, value, version: 1 }, 'resolution=ignore-duplicates,return=representation')
      : await this.request(`?id=eq.${key}&version=eq.${version}&select=version`, 'PATCH', { value, version: version + 1 }, 'return=representation');
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
    const knowledge = value.knowledge ?? [];
    const lastAnswerFromKnowledge = !![...activeHistory].reverse().find(message => message.role === 'assistant')?.knowledgeSources?.length;
    return { version, knowledge, lastAnswerFromKnowledge, context: conversationContext(activeHistory), searchContext, publicSearchTerms, snapshot: { history: value.history, memories: value.memories, notes: value.notes, generation: value.generation, storage: this.name, projects: value.projects ?? [], projectsRevision: value.projectsRevision ?? 0, library: knowledge.map(({ content: _content, ...summary }) => summary), libraryRevision: value.libraryRevision ?? 0 } };
  }
  async snapshot(): Promise<PersonalSnapshot> { return (await this.snapshotRecord()).snapshot; }
  async importKnowledge(files: MarkdownFile[], revision: number, replace: boolean) {
    if (!validMarkdownFiles(files)) throw new PersonalError('Selecione até 20 arquivos .md UTF-8, sem caminhos repetidos ou ocultos: até 50 KB por nota e 250 KB por importação.', 400);
    return this.change(value => {
      if ((value.libraryRevision ?? 0) !== revision) throw new PersonalError('A biblioteca mudou em outro aparelho. Confira as notas e revise a importação novamente.', 409);
      const notes = [...(value.knowledge ?? [])]; const now = new Date().toISOString();
      let added = 0; let updated = 0; let unchanged = 0;
      for (const file of files) {
        const path = file.path.normalize('NFC'); const content = file.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        const index = notes.findIndex(note => pathKey(note.path) === pathKey(path));
        const existing = notes[index];
        if (existing?.content === content) { unchanged++; continue; }
        if (existing && !replace) throw new PersonalError('Há notas alteradas com o mesmo caminho. Marque a atualização das cópias existentes depois de revisar.', 409);
        const note = { id: existing?.id ?? randomUUID(), path, content, title: markdownTitle({ path, content }), bytes: byteLength(content), revision: (existing?.revision ?? 0) + 1, updatedAt: now };
        if (existing) { notes[index] = note; updated++; } else { notes.push(note); added++; }
      }
      if (notes.length > MAX_KNOWLEDGE_NOTES || notes.reduce((sum, note) => sum + note.bytes, 0) > MAX_LIBRARY_BYTES) throw new PersonalError(`A biblioteca permite até ${KNOWLEDGE_CAPACITY_LABEL} de texto. Remova cópias que não precisa antes de importar.`, 409);
      if (added || updated) { value.knowledge = notes; value.libraryRevision = (value.libraryRevision ?? 0) + 1; this.resetContext(value); }
      return { ok: true, added, updated, unchanged };
    });
  }
  async editKnowledge(id: string, content: string, revision: number) {
    return this.change(value => {
      const notes = value.knowledge ?? []; const note = notes.find(note => note.id === id);
      if (!note) throw new PersonalError('Esta nota foi removida.', 404);
      if (note.revision !== revision) throw new PersonalError('Esta nota mudou em outro aparelho. Seu rascunho foi preservado; compare com a versão atual antes de salvar.', 409);
      if (!validMarkdownFiles([{ path: note.path, content }])) throw new PersonalError('Use texto Markdown UTF-8 não vazio, até 50 KB.', 400);
      const normalized = normalizeMarkdown(content);
      if (normalized === note.content) return { ok: true };
      if (notes.reduce((sum, item) => sum + item.bytes, 0) - note.bytes + byteLength(normalized) > MAX_LIBRARY_BYTES) throw new PersonalError(`A biblioteca atingiu o limite de ${MAX_LIBRARY_BYTES / 1_000_000} MB.`, 409);
      Object.assign(note, { content: normalized, bytes: byteLength(normalized), title: markdownTitle({ path: note.path, content: normalized }), revision: note.revision + 1, updatedAt: new Date().toISOString() });
      value.libraryRevision = (value.libraryRevision ?? 0) + 1; this.resetContext(value); return { ok: true };
    });
  }
  async syncKnowledge(input: SyncRequest): Promise<SyncResponse> {
    if (!validSyncRequest(input)) throw new PersonalError(`Lote de sincronização inválido: até 20 notas/250 KB e ${MAX_KNOWLEDGE_NOTES.toLocaleString('pt-BR')} caminhos conhecidos.`, 400);
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = await this.backend.read(); const value = row.value; const notes = value.knowledge ?? [];
      const result: SyncResponse = { acknowledged: [], updates: [], conflicts: [], libraryRevision: value.libraryRevision ?? 0 };
      let changed = false;
      for (const file of input.changes) {
        const existing = notes.find(note => pathKey(note.path) === pathKey(file.path));
        const content = normalizeMarkdown(file.content); const hash = sessionHash(content);
        const remoteHash = existing ? sessionHash(existing.content) : null;
        if (hash === remoteHash) { result.acknowledged.push({ path: file.path, hash }); continue; }
        if (file.baseHash !== remoteHash) {
          result.conflicts.push({ path: file.path, reason: existing ? 'changed' : 'removed', ...(existing ? { remote: { path: file.path, content: existing.content, hash: remoteHash! } } : {}) }); continue;
        }
        if ((!existing && notes.length >= MAX_KNOWLEDGE_NOTES) || notes.reduce((sum, note) => sum + note.bytes, 0) - (existing?.bytes ?? 0) + byteLength(content) > MAX_LIBRARY_BYTES) {
          result.conflicts.push({ path: file.path, reason: 'limit' }); continue;
        }
        const note: KnowledgeNote = { id: existing?.id ?? randomUUID(), path: existing?.path ?? file.path.normalize('NFC'), content, title: markdownTitle({ path: file.path, content }), bytes: byteLength(content), revision: (existing?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
        if (existing) notes[notes.indexOf(existing)] = note; else notes.push(note);
        changed = true; result.acknowledged.push({ path: file.path, hash });
      }
      const incoming = new Set(input.changes.map(file => pathKey(file.path)));
      for (const known of input.known) {
        if (incoming.has(pathKey(known.path))) continue;
        const note = notes.find(note => pathKey(note.path) === pathKey(known.path));
        // Never propagate deletions into the phone.
        if (note && sessionHash(note.content) !== known.hash && result.updates.length < MAX_IMPORT_FILES) result.updates.push({ path: known.path, content: note.content, hash: sessionHash(note.content) });
      }
      if (!changed) return result; // Idle polls do not rewrite the Supabase document.
      value.knowledge = notes; value.libraryRevision = result.libraryRevision + 1; result.libraryRevision = value.libraryRevision; this.resetContext(value);
      if (await this.backend.write(value, row.version)) return result;
    }
    throw new PersonalError('Outro aparelho atualizou a biblioteca. Sincronize novamente.', 409);
  }
  async createObsidianDevice(name: string, hash: string, version: string) {
    return this.change(value => {
      const devices = (value.obsidianDevices ?? []).filter(device => device.expires > Date.now() && device.version === version);
      if (devices.length >= 5) throw new PersonalError('Revogue uma chave antiga antes de adicionar outro aparelho. Limite: 5.', 409);
      const device = { id: randomUUID(), name, hash, version, createdAt: new Date().toISOString(), expires: Date.now() + 180 * 24 * 60 * 60 * 1000 };
      devices.push(device); value.obsidianDevices = devices;
      const { hash: _hash, version: _version, ...summary } = device; return summary;
    }, 'sessions');
  }
  async listObsidianDevices(version: string) {
    return ((await this.backend.read('sessions')).value.obsidianDevices ?? []).filter(device => device.version === version && device.expires > Date.now()).map(({ hash: _hash, version: _version, ...summary }) => summary);
  }
  async validObsidianDevice(hash: string, version: string) {
    return ((await this.backend.read('sessions')).value.obsidianDevices ?? []).some(device => device.hash === hash && device.version === version && device.expires > Date.now());
  }
  async revokeObsidianDevice(id: string) { return this.change(value => { value.obsidianDevices = (value.obsidianDevices ?? []).filter(device => device.id !== id); return { ok: true }; }, 'sessions'); }
  async deleteKnowledge(id: string, revision: number) {
    return this.change(value => {
      if ((value.libraryRevision ?? 0) !== revision) throw new PersonalError('A biblioteca mudou. Confira as notas antes de remover a cópia.', 409);
      const notes = value.knowledge ?? [];
      if (!notes.some(note => note.id === id)) throw new PersonalError('Esta cópia da nota já foi removida.', 404);
      value.knowledge = notes.filter(note => note.id !== id); value.libraryRevision = (value.libraryRevision ?? 0) + 1;
      value.history = value.history.map(message => ({ ...message, ...(message.knowledgeSources ? { knowledgeSources: message.knowledgeSources.filter(source => source.id !== id) } : {}) }));
      this.resetContext(value); return { ok: true };
    });
  }
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
        .map(({ id, role, content, createdAt, webSearch, sources, knowledgeSources }) => ({ id, role, content: content.slice(0, MAX_MESSAGE_LENGTH), createdAt,
          ...(webSearch ? { webSearch, sources } : {}), ...(knowledgeSources?.length ? { knowledgeSources } : {}) }));
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
