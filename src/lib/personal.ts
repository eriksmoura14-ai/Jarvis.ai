import type { PersonalSession, PersonalSnapshot } from '../../shared/contracts';
import { decodeHistory } from './storage';
import { validProjects } from '../../shared/projects';
import { validKnowledgeList } from '../../shared/knowledge';

let cached: { etag: string; snapshot: PersonalSnapshot } | undefined;
let cacheEpoch = 0;
export function lockPersonal() { cached = undefined; cacheEpoch++; window.dispatchEvent(new Event('jarvis-lock')); }
export async function personalRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const epoch = cacheEpoch;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(cancel, 15_000);
  try {
    const response = await fetch(`/api/personal/${path}`, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-Jarvis-Client': '1', ...(path === 'data' && cached ? { 'If-None-Match': cached.etag } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal });
    if (response.status === 304 && path === 'data' && cached) return cached.snapshot as T;
    if (response.status === 401 && path !== 'login') lockPersonal();
    const data = await response.json().catch(() => { throw new Error('Não foi possível conectar ao JARVIS. Aguarde e tente novamente.'); }) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível atualizar seus dados.');
    if (path === 'logout') { cached = undefined; cacheEpoch++; }
    if (path === 'data' && epoch === cacheEpoch && response.headers.get('etag')) cached = { etag: response.headers.get('etag')!, snapshot: data as unknown as PersonalSnapshot };
    return data;
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('O JARVIS demorou para responder. Tente novamente.');
    if (cause instanceof TypeError) throw new Error('Sem conexão com o JARVIS. Aguarde e tente novamente.');
    throw cause;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
export async function personalSession(signal?: AbortSignal): Promise<PersonalSession> {
  const session = await personalRequest<PersonalSession>('session', 'GET', undefined, signal);
  if (session.enabled !== false && (session.enabled !== true || typeof session.authenticated !== 'boolean' || !['sqlite', 'supabase'].includes(session.storage))) throw new Error('O servidor retornou um acesso pessoal inválido.');
  return session;
}
export async function personalSnapshot(signal?: AbortSignal): Promise<PersonalSnapshot> {
  const data = await personalRequest<PersonalSnapshot>('data', 'GET', undefined, signal);
  if (!Array.isArray(data.history) || !Array.isArray(data.memories) || data.memories.length > 30 || data.memories.some(memory => typeof memory.id !== 'string' || typeof memory.content !== 'string' || memory.content.length > 500)
    || !Array.isArray(data.notes) || !Number.isSafeInteger(data.generation) || !['sqlite', 'supabase'].includes(data.storage)) throw new Error('O servidor retornou dados pessoais inválidos.');
  if (data.projects !== undefined && !validProjects(data.projects) || data.projectsRevision !== undefined && (!Number.isSafeInteger(data.projectsRevision) || data.projectsRevision < 0)) throw new Error('O servidor retornou projetos inválidos.');
  if (data.library !== undefined && !validKnowledgeList(data.library) || data.libraryRevision !== undefined && (!Number.isSafeInteger(data.libraryRevision) || data.libraryRevision < 0)) throw new Error('O servidor retornou uma biblioteca inválida.');
  return { ...data, library: data.library ?? [], libraryRevision: data.libraryRevision ?? 0, projects: data.projects ?? [], projectsRevision: data.projectsRevision ?? 0, history: decodeHistory(JSON.stringify(data.history)) };
}
