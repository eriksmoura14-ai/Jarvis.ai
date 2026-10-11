import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { sessionHash, PersonalStore, SQLiteDocument } from './store.js';
import { NoteStore } from '../database.js';
import type { SyncRequest } from '../../shared/obsidian.js';
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const password = 'fixture-obsidian-password-123';
const file = { path: 'Estudos/React.md', content: '# React\nMeus estudos originais.' };
async function setup() {
  const app = await buildApp({ databasePath: ':memory:', personal: { password, secure: false } }); apps.push(app);
  const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password } });
  const headers = { 'x-jarvis-client': '1', cookie: String(login.headers['set-cookie']).split(';')[0] };
  const create = () => app.inject({ method: 'POST', url: '/api/personal/obsidian/devices', headers, payload: { name: 'Android' } });
  const grant = (await create()).json(); const deviceHeaders = { 'x-jarvis-client': '1', authorization: `Bearer ${grant.token}` };
  const sync = (payload: SyncRequest) => app.inject({ method: 'POST', url: '/api/obsidian/sync', headers: deviceHeaders, payload });
  const data = async () => (await app.inject({ url: '/api/personal/data', headers })).json();
  const edit = (id: string, content: string, revision = 1) => app.inject({ method: 'PUT', url: `/api/personal/knowledge/${id}`, headers, payload: { content, revision } });
  return { app, headers, grant, deviceHeaders, create, sync, data, edit };
}
describe('conexão Obsidian pessoal', () => {
  it('usa chave independente, com escopo apenas da biblioteca, e revogação imediata', async () => {
    const { app, headers, deviceHeaders, grant, sync } = await setup();
    const body = { changes: [{ ...file, baseHash: null }], known: [] };
    expect((await app.inject({ method: 'POST', url: '/api/obsidian/sync', headers, payload: body })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/obsidian/sync', headers: { authorization: deviceHeaders.authorization }, payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/obsidian/sync', headers: { ...deviceHeaders, origin: 'https://other.example' }, payload: body })).statusCode).toBe(403);
    for (const url of ['/api/personal/data', '/api/personal/obsidian/devices', '/api/personal/knowledge/search?q=React', '/api/notes?sessionId=fixture']) expect((await app.inject({ url, headers: deviceHeaders })).statusCode).toBe(401);
    const list = (await app.inject({ url: '/api/personal/obsidian/devices', headers })).json();
    expect(list.devices[0]).toMatchObject({ name: 'Android' }); expect(JSON.stringify(list)).not.toContain(grant.token); expect(list.devices[0].hash).toBeUndefined();
    expect((await sync(body)).statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: `/api/personal/obsidian/devices/${grant.device.id}`, headers });
    expect((await sync(body)).statusCode).toBe(401);
  });
  it('manda notas reais, normaliza UTF-8 e não altera geração nem revisão em consultas ociosas', async () => {
    const { sync, data } = await setup();
    expect((await sync({ changes: [{ ...file, content: '\uFEFF' + file.content.replace(/\n/g, '\r\n'), baseHash: null }], known: [] })).json().acknowledged).toEqual([{ path: file.path, hash: sessionHash(file.content) }]);
    const original = await data();
    expect((await sync({ changes: [{ ...file, baseHash: null }], known: [] })).json().acknowledged).toHaveLength(1);
    expect((await sync({ changes: [], known: [{ path: file.path, hash: sessionHash(file.content) }] })).json().updates).toEqual([]);
    expect((await data()).generation).toBe(original.generation); expect((await data()).libraryRevision).toBe(original.libraryRevision);
  });
  it('não sobrescreve versões diferentes na primeira conexão, nem edições simultâneas', async () => {
    const { sync, data, edit, app, headers } = await setup();
    await sync({ changes: [{ ...file, baseHash: null }], known: [] });
    const id = (await data()).library[0].id;
    const remote = '# React\nEdição feita pelo Xbox.';
    expect((await edit(id, remote)).statusCode).toBe(200);
    expect((await edit(id, '# React\nRascunho antigo.', 1)).statusCode).toBe(409);
    const conflict = (await sync({ changes: [{ ...file, content: '# React\nEdição Android.', baseHash: sessionHash(file.content) }], known: [] })).json();
    expect(conflict.conflicts[0]).toMatchObject({ reason: 'changed', remote: { content: remote } }); expect(conflict.acknowledged).toEqual([]);
    expect((await sync({ changes: [{ ...file, baseHash: null }], known: [] })).json().conflicts).toHaveLength(1);
    const updates = (await sync({ changes: [], known: [{ path: file.path, hash: sessionHash(file.content) }] })).json().updates;
    expect(updates).toEqual([{ path: file.path, content: remote, hash: sessionHash(remote) }]);
    const chosen = '# React\nVersão local revisada.';
    expect((await sync({ changes: [{ ...file, content: chosen, baseHash: sessionHash(remote) }], known: [] })).json().acknowledged).toHaveLength(1);
    expect((await app.inject({ url: `/api/personal/knowledge/${id}`, headers })).json().content).toBe(chosen);
  });
  it('não propaga remoções ou ressuscita uma cópia removida sem escolha explícita', async () => {
    const { sync, data, app, headers } = await setup();
    await sync({ changes: [{ ...file, baseHash: null }], known: [] }); const before = await data();
    await app.inject({ method: 'DELETE', url: `/api/personal/knowledge/${before.library[0].id}`, headers, payload: { libraryRevision: before.libraryRevision } });
    expect((await sync({ changes: [], known: [{ path: file.path, hash: sessionHash(file.content) }] })).json().updates).toEqual([]);
    expect((await sync({ changes: [{ ...file, content: '# React\nPreservada no celular.', baseHash: sessionHash(file.content) }], known: [] })).json().conflicts[0].reason).toBe('removed');
    expect((await data()).library).toEqual([]);
  });
  it('recusa caminhos perigosos, notas inválidas e campos de controle inventados', async () => {
    const { sync, data } = await setup();
    for (const path of ['../a.md', '.obsidian/a.md', '/a.md', 'a\\b.md']) expect((await sync({ changes: [{ ...file, path, baseHash: null }], known: [] })).statusCode).toBe(400);
    expect((await sync({ changes: [{ ...file, baseHash: 'fake' }], known: [] })).statusCode).toBe(400);
    expect((await sync({ changes: [{ ...file, baseHash: null, force: true } as SyncRequest['changes'][0]], known: [] })).statusCode).toBe(400);
    expect((await sync({ changes: [{ ...file, content: 'á'.repeat(25_001), baseHash: null }], known: [] })).statusCode).toBe(400);
    expect((await sync({ changes: [], known: [{ path: '../fake.md', hash: sessionHash('text') }] })).statusCode).toBe(400);
    expect((await data()).library).toEqual([]);
  });
  it('limita chaves e edição, sem aceitar cookies como chave de integração', async () => {
    const { create, data, edit, sync } = await setup();
    for (let i = 0; i < 4; i++) expect((await create()).statusCode).toBe(200);
    expect((await create()).statusCode).toBe(409);
    await sync({ changes: [{ ...file, baseHash: null }], known: [] }); const id = (await data()).library[0].id;
    expect((await edit(id, '')).statusCode).toBe(400); expect((await edit(id, 'a'.repeat(50_001))).statusCode).toBe(400);
    expect((await data()).library[0].revision).toBe(1);
  });
  it('persiste chaves no documento privado e invalida versão de senha e expiração', async () => {
    const sqlite = new NoteStore(':memory:'); const backend = new SQLiteDocument(sqlite); const store = new PersonalStore(backend);
    try {
      const device = await store.createObsidianDevice('Android', sessionHash('fixture-token'), 'version-1');
      expect(await new PersonalStore(backend).validObsidianDevice(sessionHash('fixture-token'), 'version-1')).toBe(true);
      expect(await store.validObsidianDevice(sessionHash('fixture-token'), 'version-2')).toBe(false);
      const row = await backend.read('sessions'); row.value.obsidianDevices![0].expires = Date.now() - 1; await backend.write(row.value, row.version, 'sessions');
      expect(await store.validObsidianDevice(sessionHash('fixture-token'), 'version-1')).toBe(false);
      await store.revokeObsidianDevice(device.id); expect((await store.listObsidianDevices('version-1'))).toEqual([]);
    } finally { sqlite.close(); }
  });
});
