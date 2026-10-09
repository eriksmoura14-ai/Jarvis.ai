import type { ChatRequest, ChatResponse, HealthResponse } from '../../shared/contracts';
import { loadBackend, normalizeBackend } from './backend';

export const BROWSER_MODE = import.meta.env.MODE === 'pages';

export async function sendMessage(body: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError');
  if (BROWSER_MODE) {
    const { browserCommand } = await import('./browser');
    if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError');
    const local = await browserCommand(body);
    if (local.command !== 'unknown' || !loadBackend()) return local;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${BROWSER_MODE ? loadBackend() : ''}/api/chat`, {
      method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(error?.error ?? 'Não foi possível enviar a mensagem.');
    }
    const data = await response.json() as ChatResponse;
    if (typeof data.message !== 'string' || !data.message.trim() || typeof data.id !== 'string' || !['local', 'groq', 'ollama'].includes(data.provider) || !Number.isFinite(Date.parse(data.createdAt))) throw new Error('O backend retornou uma resposta inválida.');
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
  return data;
}
