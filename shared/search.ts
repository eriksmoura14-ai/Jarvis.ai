import type { ChatRequest, SearchSource, WebSearchInfo } from './contracts.js';

export const MAX_SEARCH_QUERY = 300;
export const MAX_SEARCH_SOURCES = 5;

export function searchQuery(request: Pick<ChatRequest, 'message' | 'webSearch'>): string | undefined {
  const text = request.message.trim().replace(/^jarvis[,.:!]?\s+/i, '');
  const command = text.match(/^(?:pesquis(?:e|ar|a)|bus(?:que|car|ca)|procur(?:e|ar|a))(?:\s+(?:na\s+(?:web|internet)|(?:na\s+)?rede))?\s*[:,-]?\s+([\s\S]+)$/i);
  return command ? command[1].trim() : request.webSearch ? text : undefined;
}

// Search results become clickable links, never arbitrary server fetch destinations.
export function publicSourceURL(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !host.includes('.') || host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host)) return undefined;
    url.hash = '';
    return url.href;
  } catch { return undefined; }
}

export function validSources(value: unknown): value is SearchSource[] {
  return Array.isArray(value) && value.length <= MAX_SEARCH_SOURCES && value.every(source => source && typeof source === 'object'
    && typeof source.title === 'string' && source.title.trim() && source.title.length <= 200
    && typeof source.snippet === 'string' && source.snippet.length <= 700 && publicSourceURL(source.url));
}

export function validSearchInfo(value: unknown): value is WebSearchInfo {
  if (!value || typeof value !== 'object') return false;
  const info = value as Partial<WebSearchInfo>;
  return typeof info.query === 'string' && !!info.query.trim() && info.query.length <= MAX_SEARCH_QUERY
    && ['duckduckgo', 'bing'].includes(info.engine ?? '') && typeof info.searchedAt === 'string' && Number.isFinite(Date.parse(info.searchedAt));
}
