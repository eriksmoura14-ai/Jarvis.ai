import { lockPersonal } from './personal';
import { VOICE_ID_PATTERN, type SpeechOptions, type SpeechVoiceCatalog, type SpeechQuota } from '../../shared/speech';

export class SpeechRequestError extends Error {
  constructor(message: string, public readonly status = 503) { super(message); }
}
export async function speechQuota(signal: AbortSignal): Promise<SpeechQuota> {
  const response = await fetch('/api/speech/quota', { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok) {
    if (response.status === 401) lockPersonal();
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new SpeechRequestError(data?.error ?? 'Não foi possível consultar a cota de voz.', response.status);
  }
  const data = await response.json() as SpeechQuota;
  if (!data || !Number.isSafeInteger(data.used) || data.used < 0 || !Number.isSafeInteger(data.limit) || data.limit < 0
    || data.remaining !== Math.max(0, data.limit - data.used)
    || (data.nextResetAt !== undefined && (typeof data.nextResetAt !== 'string' || !Number.isFinite(Date.parse(data.nextResetAt))))) throw new SpeechRequestError('O servidor retornou uma cota inválida.');
  return data;
}
export async function listBrazilianVoices(signal: AbortSignal): Promise<SpeechVoiceCatalog> {
  const response = await fetch('/api/speech/voices', { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok) {
    if (response.status === 401) lockPersonal();
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new SpeechRequestError(data?.error ?? 'Não foi possível buscar vozes brasileiras.', response.status);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('voices' in data) || !Array.isArray(data.voices)
    || data.voices.length > 6 || !('matchedJarvis' in data) || typeof data.matchedJarvis !== 'boolean'
    || data.voices.some(voice => !voice || typeof voice.id !== 'string' || !VOICE_ID_PATTERN.test(voice.id)
      || typeof voice.name !== 'string' || voice.name.length > 80)) throw new SpeechRequestError('O servidor retornou um catálogo de vozes inválido.');
  return data as SpeechVoiceCatalog;
}
export async function requestSpeech(text: string, signal: AbortSignal, options: SpeechOptions = {}): Promise<Blob> {
  const response = await fetch('/api/speech', { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Jarvis-Client': '1' }, body: JSON.stringify({ text, ...options }), signal });
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
