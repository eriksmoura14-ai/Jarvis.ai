import type { ChatRequest, SearchSource, WebSearchInfo } from './contracts.js';
import { normalizeQuestion, personalReferenceQuestion } from './dialogue.js';

export const MAX_SEARCH_QUERY = 300;
export const MAX_SEARCH_SOURCES = 5;

export function automaticSearchQuery(message: string): string | undefined {
  // Private requests and local actions never become public searches, including
  // on Pages where the full server-side interpretation is unavailable.
  if (personalReferenceQuestion(message) || /^(?:anote|anotar|nota|apagar notas)\b/.test(normalizeQuestion(message))) return;
  const explicit = searchQuery({ message });
  if (explicit !== undefined) return explicit;
  const text = normalizeQuestion(message);
  // A continuation needs the server's verified conversation subject. Never
  // search an isolated pronoun, or accidentally copy private history into it.
  if (/\b(?:isso|nisso|disso|desse|dessa|ele|ela)\b/.test(text)) return;
  if (/^(?:o que (?:e|sao)|explique (?:o conceito|a historia)|como funciona)\b/.test(text)
    && !/\b(?:hoje|agora|atualmente|atual|atuais|mais recente|ultima versao)\b/.test(text)) return;
  const current = /\b(?:noticias?|novidades|manchetes|cotacao|preco|precos|quanto custa|clima|previsao do tempo|temperatura|ultim[oa]s?|mais recente|atualmente|atualizacoes)\b/.test(text)
    || /\b(?:quem (?:e|esta)|o que mudou|como esta|qual (?:e )?(?:a |o )?(?:situacao|versao|presidente|governador))\b.*\b(?:hoje|agora|atual|atuais)\b/.test(text)
    || /\b(?:links?|fontes|referencias) (?:sobre|de|para)\b/.test(text);
  return current ? message.trim().replace(/^(?:oi|ol[aá]|bom dia|boa tarde|boa noite)[,.:!]?\s+/i, '')
    .replace(/^jarvis[,.:!]?\s+/i, '').replace(/^por favor[,.:!]?\s+/i, '') : undefined;
}

export function searchQuery(request: Pick<ChatRequest, 'message' | 'webSearch'>): string | undefined {
  const text = request.message.trim()
    .replace(/^(?:oi|ol[aá]|bom dia|boa tarde|boa noite)[,.:!]?\s+(?=jarvis\b|pesquis|busc|busq|procur|(?:voc[eê]\s+)?(?:pode|consegue))/i, '')
    .replace(/^jarvis[,.:!]?\s+/i, '')
    .replace(/^por favor[,.:!]?\s+/i, '');
  const command = text.match(/^(?:(?:voc[eê]\s+)?(?:pode(?:ria)?|consegue)\s+)?(?:pesquis(?:e|ar|a)|bus(?:que|car|ca)|procur(?:e|ar|a))(?:\s+(?:na\s+(?:web|internet)|(?:na\s+)?rede))?\s*[:,-]?\s+([\s\S]+)$/i);
  if (command) {
    let subject = command[1].trim();
    // Politeness and the search destination can appear in either order in speech.
    for (let index = 0; index < 3; index++) subject = subject
      .replace(/^(?:(?:pra|para)\s+mim|por favor|na\s+(?:web|internet|rede))[,.:!]?\s+/i, '');
    return subject.replace(/[,!]?\s+por favor[.!]?$/i, '').trim();
  }
  return request.webSearch ? text : undefined;
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
    && typeof source.snippet === 'string' && source.snippet.length <= 700 && publicSourceURL(source.url)
    && (source.publishedAt === undefined || (typeof source.publishedAt === 'string' && source.publishedAt.length <= 64 && Number.isFinite(Date.parse(source.publishedAt)))));
}

export function validSearchInfo(value: unknown): value is WebSearchInfo {
  if (!value || typeof value !== 'object') return false;
  const info = value as Partial<WebSearchInfo>;
  return typeof info.query === 'string' && !!info.query.trim() && info.query.length <= MAX_SEARCH_QUERY
    && ['duckduckgo', 'bing'].includes(info.engine ?? '') && typeof info.searchedAt === 'string' && Number.isFinite(Date.parse(info.searchedAt))
    && (info.news === undefined || typeof info.news === 'boolean')
    && (info.queries === undefined || (Array.isArray(info.queries) && info.queries.length <= 3 && info.queries.every(query => typeof query === 'string' && !!query.trim() && query.length <= MAX_SEARCH_QUERY)))
    && (info.engines === undefined || (Array.isArray(info.engines) && info.engines.length <= 2 && info.engines.every(engine => ['duckduckgo', 'bing'].includes(engine))));
}
