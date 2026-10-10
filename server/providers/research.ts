import type { AssistantProvider, ChatRequest, ChatResponse } from '../../shared/contracts.js';
import { searchQuery } from '../../shared/search.js';
import { SearchError, WebSearch } from '../search.js';
import { HybridProvider } from './hybrid.js';

export class ResearchProvider implements AssistantProvider {
  readonly name: AssistantProvider['name'];
  private active = 0;
  private attempts: number[] = [];
  constructor(private assistant: AssistantProvider, private search: WebSearch) { this.name = assistant.name; }
  async respond(request: ChatRequest, signal?: AbortSignal, onText?: (text: string) => void): Promise<Omit<ChatResponse, 'id' | 'createdAt'>> {
    const query = searchQuery(request);
    if (query === undefined) {
      const reply = await this.assistant.respond(request, signal, onText);
      if (reply.command === 'help') reply.message += '\n\n• pesquise <assunto> — consultar a web e mostrar as fontes. A pesquisa envia o assunto ao buscador.';
      return reply;
    }
    signal?.throwIfAborted();
    const now = Date.now();
    this.attempts = this.attempts.filter(time => now - time < 60_000);
    if (this.active >= 2 || this.attempts.length >= 6) throw new SearchError('A pesquisa está ocupada. Aguarde um minuto para consultar a web novamente.', 429);
    this.attempts.push(now); this.active++;
    try {
      const results = await this.search.search(query, signal);
      signal?.throwIfAborted();
      let message = `Resultados para “${query}”:\n\n${results.sources.map((source, index) => `[${index + 1}] ${source.title}${source.snippet ? `\n${source.snippet}` : ''}`).join('\n\n')}`;
      let provider: ChatResponse['provider'] = 'local';
      if (this.assistant instanceof HybridProvider) {
        try {
          const summary = await this.assistant.research({ ...request, message: `Pesquise: ${query}` }, results, signal, onText);
          message = summary.message; provider = summary.provider;
        } catch {
          signal?.throwIfAborted();
          message = 'Encontrei fontes na web, mas o resumo por IA está indisponível. Veja os resultados:\n\n' + message;
          onText?.(message.slice(0, 6000));
        }
      }
      return { message, provider, command: 'search', sources: results.sources, webSearch: results.info };
    } finally { this.active--; }
  }
}
