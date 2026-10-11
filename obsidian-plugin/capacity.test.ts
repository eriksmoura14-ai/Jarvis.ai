import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteStore } from '../server/database';
import { PersonalStore, SQLiteDocument, SupabaseDocument, MAX_PERSONAL_DOCUMENT_BYTES } from '../server/personal/store';
import { byteLength, MAX_IMPORT_BYTES, MAX_IMPORT_FILES, MAX_KNOWLEDGE_NOTES, MAX_LIBRARY_BYTES, validKnowledgeList } from '../shared/knowledge';
import { restoredBaselines, validSyncRequest, MAX_SYNC_REQUEST_BYTES, type SyncRequest } from '../shared/obsidian';
import { SyncEngine, contentHash, type VaultBridge } from './sync-engine';

describe('capacidade e preservação da biblioteca Obsidian', () => {
  it('sincroniza 1.000 notas/10 MB em lotes, reabre SQLite e recebe com backup sem perder conflitos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-capacity-')); const database = join(dir, 'personal.sqlite');
    let db = new NoteStore(database);
    try {
      let store = new PersonalStore(new SQLiteDocument(db));
      const original = '# Meta\n' + 'a'.repeat(9993);
      const files = new Map(Array.from({ length: 1000 }, (_, index) => [`Estudos/Nota-${index}.md`, original]));
      const legacy = [...files].slice(0, 100).map(([path, content]) => ({ path, content }));
      for (let batch = 0; batch < 5; batch++) await store.importKnowledge(legacy.slice(batch * 20, (batch + 1) * 20), batch, false);
      await store.remember('Meu nome é Erik'); await store.add('owner', 'Nota rápida já existente');
      const before = await store.snapshot();
      await store.append([{ id: 'original-message', role: 'user', content: 'Minha mensagem anterior', createdAt: new Date().toISOString() }], before.generation);
      const backups: { path: string; content: string }[] = [];
      const bridge: VaultBridge = {
        readFiles: async () => [...files].map(([path, content]) => ({ path, content })),
        read: async path => files.get(path)!,
        backup: async (path, content) => { backups.push({ path, content }); },
        replace: async (path, expected, next, permitted) => { if (!permitted() || files.get(path) !== expected) throw new Error('concurrent edit'); files.set(path, next); },
      };
      const state = { baselines: Object.fromEntries(await Promise.all(legacy.map(async note => [note.path, await contentHash(note.content)]))) };
      let saved = JSON.stringify(state.baselines); const requests: SyncRequest[] = [];
      const send = async (body: SyncRequest) => {
        expect(validSyncRequest(body)).toBe(true);
        expect(body.changes.length).toBeLessThanOrEqual(MAX_IMPORT_FILES);
        expect(body.changes.reduce((sum, file) => sum + byteLength(file.content), 0)).toBeLessThanOrEqual(MAX_IMPORT_BYTES);
        expect(byteLength(JSON.stringify(body))).toBeLessThan(MAX_SYNC_REQUEST_BYTES);
        requests.push(body); return store.syncKnowledge(body);
      };
      const engine = new SyncEngine(bridge, send, state, async () => { saved = JSON.stringify(state.baselines); }, 'Estudos', () => true);
      for (let cycle = 0; cycle < 45; cycle++) await engine.sync();
      expect(engine.conflicts.size).toBe(0); expect(requests).toHaveLength(45); expect(backups).toEqual([]);
      const snapshot = await store.snapshot();
      expect(snapshot.library).toHaveLength(MAX_KNOWLEDGE_NOTES);
      expect(snapshot.library!.reduce((sum, note) => sum + note.bytes, 0)).toBe(MAX_LIBRARY_BYTES);
      expect(validKnowledgeList(snapshot.library)).toBe(true);
      for (const note of before.library!) expect(snapshot.library).toContainEqual(note);
      expect(snapshot.memories).toEqual(before.memories); expect(snapshot.notes).toEqual(before.notes);
      expect(snapshot.history[0].id).toBe('original-message'); expect(files.size).toBe(1000);
      engine.stop(); db.close(); db = new NoteStore(database); store = new PersonalStore(new SQLiteDocument(db));
      expect((await store.snapshot()).library).toEqual(snapshot.library);
      expect((await store.snapshotRecord()).knowledge.at(-1)?.content).toBe(original);
      const excess = await store.syncKnowledge({ changes: [{ path: 'Estudos/Extra.md', content: '# Extra', baseHash: null }], known: [] });
      expect(excess.conflicts).toEqual([{ path: 'Estudos/Extra.md', reason: 'limit' }]);
      const last = snapshot.library!.find(note => note.path === 'Estudos/Nota-999.md')!;
      await expect(store.editKnowledge(last.id, original + 'a', last.revision)).rejects.toThrow('10 MB');
      expect((await store.snapshot()).library).toEqual(snapshot.library);
      const restarted = { baselines: restoredBaselines(JSON.parse(saved)) };
      expect(Object.keys(restarted.baselines)).toHaveLength(1000);
      const reopened = new SyncEngine(bridge, send, restarted, async () => {}, 'Estudos', () => true);
      await reopened.sync(); expect(requests.at(-1)?.changes).toEqual([]); expect(requests.at(-1)?.known).toHaveLength(1000);
      const cloudText = '# Meta\nMudança no Xbox.';
      await store.editKnowledge(last.id, cloudText, last.revision);
      const raced = snapshot.library!.find(note => note.path === 'Estudos/Nota-998.md')!;
      await store.editKnowledge(raced.id, '# Meta\nOutra versão remota.', raced.revision);
      files.set(raced.path, '# Meta\nEdição local diferente.');
      await reopened.sync();
      expect(files.get(last.path)).toBe(cloudText); expect(backups).toEqual([{ path: last.path, content: original }]);
      expect(reopened.conflicts.get(raced.path)?.reason).toBe('changed'); expect(files.get(raced.path)).toContain('local diferente');
      expect((await store.snapshotRecord()).knowledge.find(note => note.id === raced.id)?.content).toContain('versão remota');
      expect((await store.snapshot()).library).toHaveLength(1000); expect(files.get(legacy[0].path)).toBe(original);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

  it('recusa cofre acima da capacidade sem enviar ou sobrescrever arquivos', async () => {
    let sent = false;
    for (const files of [
      Array.from({ length: 1001 }, (_, index) => ({ path: `Nota-${index}.md`, content: '# Nota' })),
      Array.from({ length: 201 }, (_, index) => ({ path: `Nota-${index}.md`, content: 'a'.repeat(50_000) })),
    ]) {
      const vault: VaultBridge = { readFiles: async () => files, read: async () => '', backup: async () => { throw new Error('unexpected backup'); }, replace: async () => { throw new Error('unexpected write'); } };
      const engine = new SyncEngine(vault, async () => { sent = true; }, { baselines: {} }, async () => {}, '', () => true);
      await expect(engine.sync()).rejects.toThrow('1.000 notas/10 MB'); expect(sent).toBe(false);
    }
    const hash = await contentHash('# Nota');
    const restored = restoredBaselines(Object.fromEntries([['../perigosa.md', hash], ['Invalida.md', 'hash falso'], ...Array.from({ length: 1001 }, (_, index) => [`Nota-${index}.md`, hash])]));
    expect(Object.keys(restored)).toHaveLength(1000); expect(restored['Nota-999.md']).toBe(hash); expect(restored['../perigosa.md']).toBeUndefined();
  });

  it('persiste e relê 10 MB de texto com escapes no Supabase sem descartar notas anteriores', async () => {
    const db = new NoteStore(':memory:');
    try {
      let row = await new SQLiteDocument(db).read(); row.version = 1;
      const content = '"\\\n'.repeat(3333) + 'a';
      row.value.knowledge = Array.from({ length: 1000 }, (_, index) => ({ id: `note-${index}`, path: `Nota-${index}.md`, title: 'Nota', bytes: byteLength(content), revision: 1, updatedAt: '2026-10-11T00:00:00.000Z', content }));
      row.value.notes = [{ content: 'Nota rápida preservada' }];
      expect(byteLength(content)).toBe(10_000); expect(byteLength(JSON.stringify([row]))).toBeGreaterThan(20_000_000);
      const methods: string[] = [];
      const transport: typeof fetch = async (input, init) => {
        methods.push(init?.method ?? 'GET');
        if (init?.method === 'GET') return Response.json([row]);
        expect(String(input)).toContain('version=eq.1&select=version');
        const written = JSON.parse(String(init?.body)); expect(byteLength(String(init?.body))).toBeLessThan(MAX_PERSONAL_DOCUMENT_BYTES);
        row = { value: written.value, version: written.version };
        return Response.json([{ version: row.version }]);
      };
      const backend = new SupabaseDocument('https://fixture.supabase.co', 'sb_secret_fixture', transport);
      const store = new PersonalStore(backend); const before = await store.snapshot();
      expect(validKnowledgeList(before.library)).toBe(true); expect(before.library).toHaveLength(1000);
      await store.remember('Meu nome é Erik');
      const reopened = new PersonalStore(new SupabaseDocument('https://fixture.supabase.co', 'sb_secret_fixture', transport));
      expect((await reopened.snapshot()).library).toEqual(before.library);
      expect((await reopened.snapshot()).notes).toEqual(before.notes);
      expect((await reopened.snapshotRecord()).knowledge.at(-1)?.content).toBe(content);
      expect(methods).toContain('PATCH'); expect(row.version).toBe(2);
      const rejected = new SupabaseDocument('https://fixture.supabase.co', 'sb_secret_fixture', async () => new Response(' '.repeat(MAX_PERSONAL_DOCUMENT_BYTES + 1)));
      await expect(rejected.read()).rejects.toThrow('armazenamento pessoal');
      let sentOversize = false;
      const guarded = new SupabaseDocument('https://fixture.supabase.co', 'sb_secret_fixture', async () => { sentOversize = true; return Response.json([]); });
      const oversized = (await new SQLiteDocument(db).read()).value; oversized.notes = [{ content: 'a'.repeat(MAX_PERSONAL_DOCUMENT_BYTES) }];
      await expect(guarded.write(oversized, 0)).rejects.toThrow('armazenamento pessoal'); expect(sentOversize).toBe(false);
    } finally { db.close(); }
  }, 15_000);
});
