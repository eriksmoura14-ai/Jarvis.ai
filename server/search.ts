import { load } from 'cheerio/slim';
import type { SearchSource, WebSearchInfo } from '../shared/contracts.js';
import { MAX_SEARCH_QUERY, MAX_SEARCH_SOURCES, publicSourceURL } from '../shared/search.js';
import { searchIntent } from './search-intent.js';

export class SearchError extends Error {
  constructor(message: string, public readonly statusCode = 503) { super(message); }
}
export interface SearchResults { sources: SearchSource[]; info: WebSearchInfo }
const clean = (value: string, length: number) => value.replace(/\s+/g, ' ').trim().slice(0, length);

function resultURL(value: string): string | undefined {
  try {
    const url = new URL(value, 'https://html.duckduckgo.com');
    if (['duckduckgo.com', 'www.duckduckgo.com', 'html.duckduckgo.com'].includes(url.hostname)) {
      const target = url.searchParams.get('uddg');
      return target ? publicSourceURL(target) : undefined;
    }
    if (url.hostname === 'www.bing.com' && url.pathname === '/news/apiclick.aspx') {
      return publicSourceURL(url.searchParams.get('url'));
    }
    return publicSourceURL(url.href);
  } catch { return undefined; }
}

export function parseResults(body: string, engine: WebSearchInfo['engine'], options: { query?: string; recent?: boolean; now?: number } = {}): SearchSource[] {
  const $ = load(body, { xmlMode: engine === 'bing' });
  $('script, style').remove();
  const sources: SearchSource[] = [];
  const seen = new Set<string>();
  const intent = options.query ? searchIntent(options.query) : undefined;
  const now = options.now ?? Date.now();
  const entries = engine === 'bing' ? $('rss channel item') : $('.result');
  entries.each((_index, element) => {
    const entry = $(element);
    const link = engine === 'bing' ? entry.find('link').text() : entry.find('a.result__a').attr('href') ?? '';
    const url = resultURL(link.trim());
    const title = clean(engine === 'bing' ? entry.find('title').text() : entry.find('.result__a').text(), 200);
    const snippet = clean(engine === 'bing' ? entry.find('description').text() : entry.find('.result__snippet').text(), 700);
    const date = engine === 'bing' ? entry.find('pubDate').text() : entry.find('time').attr('datetime') ?? '';
    const timestamp = Date.parse(date);
    const publishedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
    if (!url || !title || seen.has(url) || sources.length >= MAX_SEARCH_SOURCES) return;
    const source = { title, url, snippet, ...(publishedAt ? { publishedAt } : {}) };
    if (intent && !intent.relevant(source)) return;
    // "Últimas notícias" requires a dated result from the last seven days, not a generic web page.
    if (options.recent && (!publishedAt || timestamp < now - 7 * 86_400_000 || timestamp > now + 300_000)) return;
    seen.add(url); sources.push(source);
  });
  return sources;
}

async function boundedText(response: Response): Promise<string> {
  if (!response.body) throw new SearchError('O buscador retornou uma resposta vazia.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 600_000) throw new SearchError('O buscador retornou dados demais. Tente outra consulta.');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}

export class WebSearch {
  constructor(private transport: typeof fetch = fetch, private timeoutMs = 4500) {}
  async search(query: string, signal?: AbortSignal): Promise<SearchResults> {
    query = query.trim();
    if (!query || query.length > MAX_SEARCH_QUERY) throw new SearchError('Use uma pesquisa com até 300 caracteres.', 400);
    const intent = searchIntent(query);
    let empty = false;
    for (const engine of intent.news ? ['bing', 'duckduckgo'] as const : ['duckduckgo', 'bing'] as const) {
      signal?.throwIfAborted();
      const url = new URL(engine === 'duckduckgo' ? 'https://html.duckduckgo.com/html/' : intent.news ? 'https://www.bing.com/news/search' : 'https://www.bing.com/search');
      url.searchParams.set('q', intent.engineQuery);
      if (engine === 'bing') { url.searchParams.set('format', 'rss'); url.searchParams.set('setlang', 'pt-br'); url.searchParams.set('cc', 'br'); }
      else { url.searchParams.set('kl', 'br-pt'); if (intent.news) url.searchParams.set('df', 'w'); }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.transport(url.href, { signal: controller.signal, redirect: 'error', headers: {
          Accept: engine === 'bing' ? 'application/rss+xml, application/xml, text/xml' : 'text/html',
          'User-Agent': 'JarvisPersonalAssistant/0.1 (web search)',
        } });
        // DuckDuckGo challenges frequently use HTTP 202; do not call a challenge a search result.
        if (response.status !== 200) { await response.body?.cancel(); continue; }
        const body = await boundedText(response);
        const type = response.headers.get('content-type') ?? '';
        if (engine === 'bing' && (!/xml/i.test(type) || !/<rss[\s>]/i.test(body))) continue;
        if (engine === 'duckduckgo' && (!/html/i.test(type) || /anomaly\.js|anomaly-modal|challenge-form/i.test(body))) continue;
        const sources = parseResults(body, engine, { query, recent: intent.news });
        if (sources.length) return { sources, info: { query, engine, searchedAt: new Date().toISOString() } };
        if (engine === 'bing' || /no-results|No results found/i.test(body) || parseResults(body, engine).length) empty = true;
      } catch {
        if (signal?.aborted) signal.throwIfAborted();
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    throw new SearchError(empty ? intent.news ? 'Não encontrei notícias relacionadas ao assunto com data nos últimos sete dias. Tente um tema mais específico.' : 'Não encontrei resultados relacionados a essa pesquisa. Tente palavras mais específicas.'
      : 'Não consegui consultar a web agora. O buscador pode estar bloqueando a consulta; tente novamente mais tarde.');
  }
}
