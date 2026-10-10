import { ExternalLink, Globe } from 'lucide-react';
import type { SearchSource, WebSearchInfo } from '../../shared/contracts';

export function SearchSources({ sources, info }: { sources?: SearchSource[]; info?: WebSearchInfo }) {
  if (!sources?.length || !info) return null;
  return <section className="search-sources" aria-label="Fontes da pesquisa">
    <p className="search-caption"><Globe size={13} /> Fontes · {(info.engines ?? [info.engine]).map(engine => engine === 'bing' ? 'Bing' : 'DuckDuckGo').join(' / ')} · Consulta em <time dateTime={info.searchedAt}>{new Date(info.searchedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time></p>
    {info.queries && info.queries.length > 1 && <details className="search-queries"><summary data-gamepad>Consultas realizadas ({info.queries.length})</summary><ul>{info.queries.map(query => <li key={query}>{query}</li>)}</ul></details>}
    <ol>{sources.map((source, index) => <li key={source.url}><a data-gamepad href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      <span className="search-reference">[{index + 1}]</span><span><strong>{source.title}</strong><small>{new URL(source.url).hostname}{source.publishedAt && <> · Publicado em <time dateTime={source.publishedAt}>{new Date(source.publishedAt).toLocaleDateString('pt-BR')}</time></>}</small></span><ExternalLink size={14} aria-hidden="true" />
    </a></li>)}</ol>
    <small className="search-disclaimer">Resultados e trechos do buscador. Confira as páginas para confirmar os detalhes.</small>
  </section>;
}
