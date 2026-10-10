import type { ChatRequest, ChatResponse, HealthResponse } from '../../shared/contracts';
import { loadBackend, normalizeBackend } from './backend';
import { searchQuery, validSearchInfo, validSources } from '../../shared/search';
import { lockPersonal } from './personal';
import { streamLines } from '../../shared/stream';

export const BROWSER_MODE = import.meta.env.MODE === 'pages';

export interface ChatProgress { onText?: (text: string) => void; onReady?: () => void }
export async function sendMessage(body: ChatRequest, signal?: AbortSignal, progress: ChatProgress = {}): Promise<ChatResponse> {
  if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError');
  if (BROWSER_MODE) {
    const { browserCommand } = await import('./browser');
    if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError');
    if (searchQuery(body) !== undefined) {
      if (!loadBackend()) throw new Error('A pesquisa na web precisa de um backend conectado em Preferências.');
    } else {
      const local = await browserCommand(body);
      if (local.command !== 'unknown' || !loadBackend()) return local;
    }
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${BROWSER_MODE ? loadBackend() : ''}/api/chat`, {
      method: 'POST', credentials: BROWSER_MODE ? 'omit' : 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(!BROWSER_MODE ? { 'X-Jarvis-Client': '1' } : {}) }, body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 && !BROWSER_MODE) lockPersonal();
      const error = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(error?.error ?? 'Não foi possível enviar a mensagem.');
    }
    let data: ChatResponse;
    if (response.headers.get('content-type')?.startsWith('application/x-ndjson')) {
      if (!response.body) throw new Error('A resposta do assistente foi interrompida.');
      let result: ChatResponse | undefined;
      for await (const line of streamLines(response.body, controller.signal)) {
        if (!line) continue;
        const event = JSON.parse(line) as { type?: string; text?: unknown; response?: ChatResponse; error?: unknown };
        if (event.type === 'ready') progress.onReady?.();
        else if (event.type === 'text' && typeof event.text === 'string' && event.text.length <= 6000) progress.onText?.(event.text);
        else if (event.type === 'error' && typeof event.error === 'string') throw new Error(event.error);
        else if (event.type === 'result' && event.response) { result = event.response; break; }
        else throw new Error('O backend retornou uma resposta progressiva inválida.');
      }
      if (!result) throw new Error('A resposta do assistente foi interrompida. Tente novamente.');
      data = result;
    } else data = await response.json() as ChatResponse;
    if (typeof data.message !== 'string' || !data.message.trim() || typeof data.id !== 'string' || !['local', 'groq', 'ollama'].includes(data.provider) || !Number.isFinite(Date.parse(data.createdAt))) throw new Error('O backend retornou uma resposta inválida.');
    if ((data.sources !== undefined && !validSources(data.sources)) || (data.webSearch !== undefined && !validSearchInfo(data.webSearch))) throw new Error('O backend retornou fontes de pesquisa inválidas.');
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('O assistente demorou para responder. Tente novamente.');
    if (error instanceof TypeError) throw new Error('Sem conexão com o assistente. Confira se o servidor está em execução.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
export async function checkHealth(signal: AbortSignal): Promise<HealthResponse> {
  if (BROWSER_MODE && !loadBackend()) return { status: 'ok', provider: 'local', version: '0.1.0' };
  return checkBackend(BROWSER_MODE ? loadBackend() : '', signal);
}
export async function checkBackend(endpoint: string, signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${normalizeBackend(endpoint)}/api/health`, { signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('Servidor indisponível');
  const data = await response.json() as HealthResponse;
  if (data.status !== 'ok' || !['local', 'groq', 'ollama'].includes(data.provider)) throw new Error('Este endereço não corresponde a um backend JARVIS válido.');
  if (data.ai && (data.ai.configured !== true || !['groq', 'ollama'].includes(data.ai.provider) || typeof data.ai.model !== 'string')) throw new Error('O backend retornou uma configuração de IA inválida.');
  if (data.speech && (data.speech.configured !== true || data.speech.provider !== 'elevenlabs')) throw new Error('O backend retornou uma configuração de voz inválida.');
  return data;
}
