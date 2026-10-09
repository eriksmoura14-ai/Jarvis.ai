const BACKEND_KEY = 'jarvis.backend.v1';
export function normalizeBackend(value: string): string {
  if (!value.trim()) return '';
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Use HTTPS para conectar o backend pelo celular. HTTP é permitido apenas em localhost.');
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Informe apenas o endereço do backend, sem senha, caminho ou parâmetros.');
  return url.origin;
}
export function loadBackend(): string {
  try { return normalizeBackend(localStorage.getItem(BACKEND_KEY) ?? ''); } catch { return ''; }
}
export function saveBackend(value: string): void {
  const endpoint = normalizeBackend(value);
  try { if (endpoint) localStorage.setItem(BACKEND_KEY, endpoint); else localStorage.removeItem(BACKEND_KEY); }
  catch { throw new Error('O navegador bloqueou o armazenamento do endereço. Confira as permissões.'); }
}
