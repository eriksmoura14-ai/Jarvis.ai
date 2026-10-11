import { byteLength, MAX_IMPORT_BYTES, validMarkdownFiles, pathKey, type MarkdownFile } from '../shared/knowledge';
import { inVaultScope, normalizeMarkdown, validHash, validSyncResponse, type SyncRequest, type SyncResponse, type SyncConflict, type SyncFile } from '../shared/obsidian';
export interface VaultBridge {
  readFiles(folder: string): Promise<MarkdownFile[]>;
  read(path: string): Promise<string>;
  backup(path: string, content: string): Promise<void>;
  // Must compare inside Vault.process, after creating the backup, and never create a missing note.
  replace(path: string, expected: string, next: string, permitted: () => boolean): Promise<void>;
}
export interface SyncState { baselines: Record<string, string> }
export const contentHash = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeMarkdown(text)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};
export class SyncEngine {
  conflicts = new Map<string, SyncConflict>();
  busy = false; private closed = false;
  constructor(private vault: VaultBridge, private send: (body: SyncRequest) => Promise<unknown>, readonly state: SyncState, private save: () => Promise<void>, readonly folder: string, private allowWrites: () => boolean) {}
  stop() { this.closed = true; }
  private active() { if (this.closed) throw new Error('A conexão mudou. Sincronize novamente.'); }
  private async remote(body: SyncRequest): Promise<SyncResponse> {
    this.active(); const response = await this.send(body); this.active();
    if (!validSyncResponse(response)) throw new Error('Resposta de sincronização inválida. Nenhuma nota foi sobrescrita.');
    const changes = new Map(body.changes.map(file => [pathKey(file.path), file]));
    const known = new Map(body.known.map(file => [pathKey(file.path), file]));
    const returned = [...response.acknowledged, ...response.updates, ...response.conflicts];
    if (new Set(returned.map(file => pathKey(file.path))).size !== returned.length) throw new Error('Resposta contém caminhos repetidos.');
    for (const ack of response.acknowledged) {
      const sent = changes.get(pathKey(ack.path));
      if (!sent || ack.path !== sent.path || ack.hash !== await contentHash(sent.content)) throw new Error('Confirmação não corresponde à nota enviada.');
    }
    for (const update of response.updates) {
      const requested = known.get(pathKey(update.path));
      if (!requested || requested.path !== update.path || changes.has(pathKey(update.path)) || !inVaultScope(update.path, this.folder) || update.hash !== await contentHash(update.content)) throw new Error('Atualização fora das notas solicitadas.');
    }
    for (const conflict of response.conflicts) {
      const sent = changes.get(pathKey(conflict.path));
      if (!sent || sent.path !== conflict.path || conflict.remote && (conflict.remote.path !== conflict.path || conflict.remote.hash !== await contentHash(conflict.remote.content))) throw new Error('Conflito não corresponde à nota enviada.');
    }
    this.active(); return response;
  }
  private async receive(remote: SyncFile, expected: string) {
    this.active(); if (!this.allowWrites()) throw new Error('Ative “Receber alterações do JARVIS” antes de escrever no cofre.');
    const current = await this.vault.read(remote.path); this.active();
    if (normalizeMarkdown(current) !== normalizeMarkdown(expected)) throw new Error('A nota mudou no Obsidian durante a sincronização.');
    await this.vault.backup(remote.path, current); this.active();
    await this.vault.replace(remote.path, current, remote.content, () => !this.closed && this.allowWrites()); this.active();
    this.state.baselines[remote.path] = remote.hash; await this.save();
  }
  async sync() {
    if (this.busy || this.closed) return 'Sincronização já em andamento ou conexão encerrada.';
    this.busy = true;
    try {
      const read = await this.vault.readFiles(this.folder); this.active();
      const eligible = read.filter(file => inVaultScope(file.path, this.folder));
      if (eligible.length > 100 || eligible.reduce((sum, file) => sum + byteLength(file.content), 0) > 1_000_000) throw new Error('Escolha uma pasta menor: até 100 notas e 1 MB.');
      if (new Set(eligible.map(file => pathKey(file.path))).size !== eligible.length) throw new Error('Há nomes de notas equivalentes. Renomeie antes de sincronizar.');
      const files = eligible.filter(file => validMarkdownFiles([file]));
      const ignored = eligible.length - files.length;
      const changes: SyncRequest['changes'] = []; const known: SyncRequest['known'] = []; let bytes = 0;
      for (const file of files) {
        const hash = await contentHash(file.content); this.active();
        const baseline = validHash(this.state.baselines[file.path]) ? this.state.baselines[file.path] : null;
        if (hash === baseline) known.push({ path: file.path, hash });
        else if (!this.conflicts.has(file.path) && changes.length < 20 && bytes + byteLength(file.content) <= MAX_IMPORT_BYTES) {
          changes.push({ ...file, baseHash: baseline }); bytes += byteLength(file.content);
        }
      }
      const response = await this.remote({ changes, known });
      for (const ack of response.acknowledged) this.state.baselines[ack.path] = ack.hash;
      for (const conflict of response.conflicts) this.conflicts.set(conflict.path, conflict);
      let received = 0; let waiting = 0;
      for (const update of response.updates) {
        if (!this.allowWrites()) { waiting++; continue; }
        const captured = files.find(file => file.path === update.path)!;
        try { await this.receive(update, captured.content); received++; }
        catch (cause) { this.active(); this.conflicts.set(update.path, { path: update.path, reason: 'changed', remote: update }); if (!(cause instanceof Error)) throw cause; }
      }
      // Remove stale baseline metadata, never remove files on either side.
      this.state.baselines = Object.fromEntries(Object.entries(this.state.baselines).filter(([path, hash]) => files.some(file => file.path === path) && validHash(hash)));
      this.active(); await this.save();
      return `${response.acknowledged.length} enviada(s), ${received} recebida(s). ${this.conflicts.size} conflito(s).${waiting ? ` ${waiting} alteração(ões) aguardando permissão de escrita.` : ''}${ignored ? ` ${ignored} nota(s) vazia(s), inválida(s) ou acima de 50 KB ignorada(s).` : ''} Até 20 notas por ciclo; os próximos ciclos enviam o restante.`;
    } finally { this.busy = false; }
  }
  async resolve(path: string, choice: 'local' | 'remote') {
    if (this.busy) throw new Error('Aguarde a sincronização terminar.');
    const conflict = this.conflicts.get(path); if (!conflict || !inVaultScope(path, this.folder)) throw new Error('Conflito indisponível.');
    if (conflict.reason === 'limit') throw new Error('Libere espaço na biblioteca e tente novamente.');
    this.busy = true;
    try {
      this.active(); const content = await this.vault.read(path); this.active();
      if (choice === 'remote') {
        if (!conflict.remote) throw new Error('A cópia remota foi removida. O arquivo local foi preservado.');
        await this.receive(conflict.remote, content);
      } else {
        if (!validMarkdownFiles([{ path, content }])) throw new Error('Esta nota está vazia, inválida ou maior que 50 KB.');
        if (conflict.remote) { await this.vault.backup(path, conflict.remote.content); this.active(); }
        const response = await this.remote({ changes: [{ path, content, baseHash: conflict.remote?.hash ?? null }], known: [] });
        if (!response.acknowledged.length) {
          if (response.conflicts[0]) this.conflicts.set(path, response.conflicts[0]);
          throw new Error('A cópia remota mudou novamente. Compare as versões atualizadas.');
        }
        this.state.baselines[path] = response.acknowledged[0].hash; await this.save();
      }
      this.conflicts.delete(path);
    } finally { this.busy = false; }
  }
  retry(path: string) { this.conflicts.delete(path); }
}
