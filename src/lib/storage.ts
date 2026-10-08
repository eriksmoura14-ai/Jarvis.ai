import type { Message } from '../../shared/contracts';

export const HISTORY_KEY = 'jarvis.history.v1';
const SESSION_KEY = 'jarvis.session.v1';
export const MAX_HISTORY = 100;
export function makeId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function loadSession(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(existing)) return existing;
    const id = makeId();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch { return makeId(); }
}
export function decodeHistory(value: string | null): Message[] {
  if (!value || value.length > 2_000_000) return [];
  try {
    const data: unknown = JSON.parse(value);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is Message => {
      if (!item || typeof item !== 'object') return false;
      const m = item as Partial<Message>;
      return typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant')
        && typeof m.content === 'string' && m.content.length <= 210_000
        && typeof m.createdAt === 'string' && Number.isFinite(Date.parse(m.createdAt));
    }).slice(-MAX_HISTORY);
  } catch { return []; }
}
export function loadHistory(): Message[] {
  try { return decodeHistory(localStorage.getItem(HISTORY_KEY)); } catch { return []; }
}
export function loadVoicePreference(): boolean {
  try { return localStorage.getItem('jarvis.voice.v1') === 'true'; } catch { return false; }
}
export function loadView(): 'voice' | 'chat' {
  try { return localStorage.getItem('jarvis.view.v1') === 'chat' ? 'chat' : 'voice'; } catch { return 'voice'; }
}
