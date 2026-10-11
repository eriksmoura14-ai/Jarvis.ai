import { describe, expect, it, vi } from 'vitest';
import { SyncEngine, contentHash, type VaultBridge } from './sync-engine';
import { validSyncRequest, validVaultFolder, inVaultScope, normalizeMarkdown, type SyncResponse, type SyncRequest } from '../shared/obsidian';
const path = 'Estudos/React.md'; const original = '# React\nAnotação original.';
const blank: SyncResponse = { acknowledged: [], updates: [], conflicts: [], libraryRevision: 1 };
async function setup(baseline = true, writes = true) {
  const files = new Map([[path, original]]); const backups: string[] = []; let duringWrite: (() => void) | undefined;
  const vault: VaultBridge = {
    readFiles: async () => [...files].map(([path, content]) => ({ path, content })),
    read: async path => { const value = files.get(path); if (value === undefined) throw new Error('missing'); return value; },
    backup: async (_path, text) => { backups.push(text); },
    replace: async (path, expected, next, permitted) => { duringWrite?.(); if (!permitted() || normalizeMarkdown(files.get(path) ?? '') !== normalizeMarkdown(expected)) throw new Error('concurrent edit'); files.set(path, next); },
  };
  const send = vi.fn<(body: SyncRequest) => Promise<unknown>>().mockResolvedValue(blank);
  const save = vi.fn<() => Promise<void>>().mockResolvedValue();
  const state = { baselines: baseline ? { [path]: await contentHash(original) } : {} };
  const engine = new SyncEngine(vault, send, state, save, 'Estudos', () => writes);
  return { engine, files, backups, send, vault, state, save, race: (fn: () => void) => { duringWrite = fn; } };
}
describe('plugin Obsidian com cofre real por adaptação', () => {
  it('envia uma nota e grava somente o hash confirmado, sem escrever o arquivo local', async () => {
    const { engine, send, files, backups, state } = await setup(false);
    send.mockResolvedValue({ ...blank, acknowledged: [{ path, hash: await contentHash(original) }] });
    await engine.sync(); expect(send.mock.calls[0][0].changes).toEqual([{ path, content: original, baseHash: null }]);
    expect(state.baselines[path]).toBe(await contentHash(original)); expect(files.get(path)).toBe(original); expect(backups).toEqual([]);
  });
  it('limita lotes, não envia notas privadas fora da pasta, anexos ou backups', async () => {
    const { engine, files, send } = await setup(false);
    for (let i = 0; i < 22; i++) files.set(`Estudos/${i}.md`, '# Uma nota');
    files.set('Pessoal/Senha.md', '# Privado'); files.set('.jarvis-backups/antiga.md', original); files.set('Estudos/imagem.png', 'anexo');
    await engine.sync(); const body = send.mock.calls[0][0]; expect(validSyncRequest(body)).toBe(true); expect(body.changes).toHaveLength(20); expect(body.changes.some(file => file.path.includes('Senha'))).toBe(false);
    expect(validVaultFolder('../Estudos')).toBe(false); expect(inVaultScope('Estudos2/Teste.md', 'Estudos')).toBe(false);
  });
  it('preserva CRLF/BOM no backup e recebe somente com autorização', async () => {
    const remote = '# React\nEdição Xbox.';
    const denied = await setup(true, false); denied.send.mockResolvedValue({ ...blank, updates: [{ path, content: remote, hash: await contentHash(remote) }] });
    expect(await denied.engine.sync()).toContain('aguardando permissão'); expect(denied.files.get(path)).toBe(original); expect(denied.backups).toEqual([]);
    const allowed = await setup(); allowed.files.set(path, '\uFEFF' + original.replace(/\n/g, '\r\n')); allowed.send.mockResolvedValue({ ...blank, updates: [{ path, content: remote, hash: await contentHash(remote) }] });
    await allowed.engine.sync(); expect(allowed.backups).toEqual(['\uFEFF' + original.replace(/\n/g, '\r\n')]); expect(allowed.files.get(path)).toBe(remote);
  });
  it('não escreve se o backup falhar ou a nota mudar dentro do Vault.process', async () => {
    const remote = '# React\nEdição Xbox.'; const response = { ...blank, updates: [{ path, content: remote, hash: await contentHash(remote) }] };
    const failed = await setup(); failed.send.mockResolvedValue(response); failed.vault.backup = async () => { throw new Error('storage full'); };
    await failed.engine.sync(); expect(failed.files.get(path)).toBe(original); expect(failed.state.baselines[path]).toBe(await contentHash(original)); expect(failed.engine.conflicts.size).toBe(1);
    const racing = await setup(); racing.send.mockResolvedValue(response); racing.race(() => racing.files.set(path, '# React\nAlteração durante a gravação.'));
    await racing.engine.sync(); expect(racing.files.get(path)).toContain('durante a gravação'); expect(racing.backups).toEqual([original]); expect(racing.engine.conflicts.size).toBe(1);
  });
  it('recusa resposta com hashes inventados, travessia ou nota não solicitada', async () => {
    for (const attack of [
      { ...blank, updates: [{ path: '../outro.md', content: original, hash: await contentHash(original) }] },
      { ...blank, updates: [{ path: 'Estudos/Outra.md', content: original, hash: await contentHash(original) }] },
      { ...blank, updates: [{ path, content: 'Outra versão', hash: await contentHash(original) }] },
      { ...blank, acknowledged: [{ path, hash: await contentHash(original) }] },
    ]) {
      const fixture = await setup(); fixture.send.mockResolvedValue(attack);
      await expect(fixture.engine.sync()).rejects.toThrow(); expect(fixture.files.get(path)).toBe(original); expect(fixture.backups).toEqual([]);
    }
  });
  it('protege edições durante a requisição e não confirma texto que não foi enviado', async () => {
    const { engine, send, files, state } = await setup(false);
    send.mockImplementation(async () => { files.set(path, '# React\nEdição durante rede.'); return { ...blank, acknowledged: [{ path, hash: await contentHash(original) }] }; });
    await engine.sync(); expect(state.baselines[path]).toBe(await contentHash(original)); expect(files.get(path)).toContain('durante rede');
    send.mockResolvedValue(blank); await engine.sync(); expect(send.mock.calls[1][0].changes[0].content).toContain('durante rede');
  });
  it('exige escolha explícita no conflito e protege a versão remota antes de substituí-la', async () => {
    const remote = '# React\nEdição Xbox.'; const { engine, send, files, backups } = await setup(false);
    send.mockResolvedValue({ ...blank, conflicts: [{ path, reason: 'changed', remote: { path, content: remote, hash: await contentHash(remote) } }] });
    await engine.sync(); expect(files.get(path)).toBe(original); expect(backups).toEqual([]);
    send.mockResolvedValue({ ...blank, acknowledged: [{ path, hash: await contentHash(original) }] }); await engine.resolve(path, 'local');
    expect(send.mock.calls[1][0].changes[0].baseHash).toBe(await contentHash(remote)); expect(backups).toEqual([remote]); expect(engine.conflicts.size).toBe(0);
  });
  it('não propaga exclusões e cancela uma resposta de conexão encerrada', async () => {
    const { engine, send, files, backups } = await setup();
    send.mockImplementation(async () => { engine.stop(); return { ...blank, updates: [{ path, content: 'Novo', hash: await contentHash('Novo') }] }; });
    await expect(engine.sync()).rejects.toThrow('conexão mudou'); expect(files.get(path)).toBe(original); expect(backups).toEqual([]);
  });
});
