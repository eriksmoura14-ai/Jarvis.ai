import { ExternalLink, Globe } from 'lucide-react';
import type { SearchSource, WebSearchInfo } from '../../shared/contracts';

export function SearchSources({ sources, info }: { sources?: SearchSource[]; info?: WebSearchInfo }) {
  if (!sources?.length || !info) return null;
  return <section className="search-sources" aria-label="Fontes da pesquisa">
    <p className="search-caption"><Globe size={13} /> Fontes · {info.engine === 'bing' ? 'Bing' : 'DuckDuckGo'} · Consulta em <time dateTime={info.searchedAt}>{new Date(info.searchedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time></p>
    <ol>{sources.map((source, index) => <li key={source.url}><a data-gamepad href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      <span className="search-reference">[{index + 1}]</span><span><strong>{source.title}</strong><small>{new URL(source.url).hostname}</small></span><ExternalLink size={14} aria-hidden="true" />
    </a></li>)}</ol>
    <small className="search-disclaimer">Resultados e trechos do buscador. Confira as páginas para confirmar os detalhes.</small>
  </section>;
}
