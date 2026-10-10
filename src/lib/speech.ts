import { lockPersonal } from './personal';

export class SpeechRequestError extends Error {
  constructor(message: string, public readonly status = 503) { super(message); }
}
export async function requestSpeech(text: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/speech', { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Jarvis-Client': '1' }, body: JSON.stringify({ text }), signal });
  if (!response.ok) {
    if (response.status === 401) lockPersonal();
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new SpeechRequestError(data?.error ?? 'Não foi possível preparar a voz por IA.', response.status);
  }
  if (!response.headers.get('content-type')?.startsWith('audio/mpeg')) throw new SpeechRequestError('O servidor retornou um áudio inválido.');
  const reader = response.body?.getReader();
  if (!reader) throw new SpeechRequestError('O servidor retornou um áudio vazio.');
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4_000_000) throw new SpeechRequestError('O áudio excedeu o limite.');
      chunks.push(part.value.slice().buffer);
    }
    if (!size) throw new SpeechRequestError('O servidor retornou um áudio vazio.');
    return new Blob(chunks, { type: 'audio/mpeg' });
  } finally { await reader.cancel().catch(() => {}); }
}
