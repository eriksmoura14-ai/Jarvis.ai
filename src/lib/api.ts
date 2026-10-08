import type { ChatRequest, ChatResponse, HealthResponse } from '../../shared/contracts';

export async function sendMessage(body: ChatRequest): Promise<ChatResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(error?.error ?? 'Não foi possível enviar a mensagem.');
    }
    return await response.json() as ChatResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('O assistente demorou para responder. Tente novamente.');
    if (error instanceof TypeError) throw new Error('Sem conexão com o assistente. Confira se o servidor está em execução.');
    throw error;
  } finally { clearTimeout(timer); }
}
export async function checkHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Servidor indisponível');
  return response.json() as Promise<HealthResponse>;
}
