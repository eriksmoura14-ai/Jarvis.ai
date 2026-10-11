import type { AssistantProvider, ChatResponse } from '../../shared/contracts.js';
import { MAX_SEARCH_QUERY, MAX_SEARCH_SOURCES, searchQuery } from '../../shared/search.js';
import { SearchError, WebSearch, type SearchResults } from '../search.js';
import { searchIntent } from '../search-intent.js';
import { personalQuestion, validatedPlan, type AssistantInput, type SearchPlan } from '../interpretation.js';
import { HybridProvider } from './hybrid.js';
import type { ProjectChange } from '../../shared/projects.js';

export class ResearchProvider implements AssistantProvider {
  readonly name: AssistantProvider['name'];
  private active = 0;
  private attempts: number[] = [];
  constructor(private assistant: AssistantProvider, private search: WebSearch) { this.name = assistant.name; }
  async respond(request: AssistantInput, signal?: AbortSignal, onText?: (text: string) => void): Promise<Omit<ChatResponse, 'id' | 'createdAt'> & { projectChange?: ProjectChange }> {
    // Personal actions win over a sticky web checkbox. Models cannot mutate personal data.
    const commandText = request.message.trim().replace(/^jarvis[,.:!]?\s+/i, '');
    const localPersonal = /^(?:anot(?:ar|e)|nota)\s+|^(?:apagar notas|notas|minhas notas|listar notas)[.!?]*$/i.test(commandText);
    const projectIntent = !!request.projectData && /^(?:jarvis[,.:!]?\s+)?(?:crie|criar|organize|organizar|monte|montar|planeje|planejar|conclui|terminei|adicione|adicionar)\b/i.test(commandText) && /\b(?:projetos?|tarefas?|planos?|etapas?)\b/i.test(commandText);
    if (localPersonal || personalQuestion(request.message) || projectIntent) return this.assistant.respond({ ...request, webSearch: false }, signal, onText);
    const explicit = searchQuery({ ...request, webSearch: false });
    let plan: SearchPlan | undefined;
    if (explicit !== undefined || request.webSearch) {
      const query = explicit ?? searchQuery(request)!;
      if (!query.trim() || query.length > MAX_SEARCH_QUERY) throw new SearchError('Use uma pesquisa com até 300 caracteres.', 400);
      plan = { queries: [query], news: searchIntent(query).news };
      if (this.assistant instanceof HybridProvider) {
        // Explicit requests still benefit from complementary queries. If planning fails,
        // the public subject remains searchable without relying on the model.
        try {
          const proposal = await this.assistant.planResearch(request, signal);
          if (proposal.projectChange) return proposal;
          if ('searchPlan' in proposal) plan = validatedPlan(proposal.searchPlan, request) ?? plan;
        } catch { signal?.throwIfAborted(); }
      }
    } else {
      const reply = await this.assistant.respond(request, signal, onText);
      if ('projectChange' in reply) return reply as Omit<ChatResponse, 'id' | 'createdAt'> & { projectChange: ProjectChange };
      if ('searchPlan' in reply) plan = validatedPlan(reply.searchPlan, request);
      if (!plan) {
        if (reply.command === 'help') reply.message += '\n\n• pesquise <assunto> — consultar a web com fontes. Com IA conectada, também interpreto quando o pedido precisa de pesquisa.';
        return { message: reply.message || 'Não consegui interpretar a pesquisa. Qual assunto você quer consultar?', command: reply.command, provider: reply.provider };
      }
    }
    return this.research(request, plan, signal, onText);
  }
  private async research(request: AssistantInput, plan: SearchPlan, signal?: AbortSignal, onText?: (text: string) => void) {
    signal?.throwIfAborted();
    const now = Date.now();
    this.attempts = this.attempts.filter(time => now - time < 60_000);
    if (this.active >= 2 || this.attempts.length >= 6) throw new SearchError('A pesquisa está ocupada. Aguarde um minuto para consultar a web novamente.', 429);
    this.attempts.push(now); this.active++;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timeout = setTimeout(cancel, 10_000);
    const tried: string[] = [];
    const found: SearchResults[] = [];
    let lastError: unknown;
    const run = async (query: string) => {
      tried.push(query);
      try { found.push(await this.search.search(query, controller.signal, { news: plan.news })); }
      catch (error) { lastError = error; }
    };
    try {
      let cursor = 0;
      const worker = async () => { while (cursor < plan.queries.length && !controller.signal.aborted) await run(plan.queries[cursor++]); };
      await Promise.all([worker(), worker()]);
      signal?.throwIfAborted();
      // One bounded reformulation, never a blind retry of the same failing query.
      if (!found.length && tried.length < 3 && !controller.signal.aborted) {
        const keywords = searchIntent(plan.queries[0]).keywords;
        if (keywords && !tried.includes(keywords)) await run(keywords);
      }
      signal?.throwIfAborted();
      if (!found.length) throw lastError instanceof SearchError ? lastError : new SearchError('Não consegui concluir as consultas a tempo. Tente novamente.');
      clearTimeout(timeout);
      const sources: SearchResults['sources'] = [];
      // Round-robin preserves coverage when comparing several subjects.
      for (let index = 0; index < MAX_SEARCH_SOURCES; index++) for (const result of found) {
        const source = result.sources[index];
        if (source && sources.length < MAX_SEARCH_SOURCES && !sources.some(existing => existing.url === source.url)) sources.push(source);
      }
      const engines = [...new Set(found.map(result => result.info.engine))];
      const results: SearchResults = { sources, info: { query: plan.queries[0], engine: engines[0], searchedAt: new Date().toISOString(), queries: tried, engines, news: plan.news } };
      let message = `Resultados para “${results.info.query}”:\n\n${sources.map((source, index) => `[${index + 1}] ${source.title}${source.snippet ? `\n${source.snippet}` : ''}`).join('\n\n')}`;
      let provider: ChatResponse['provider'] = 'local';
      if (this.assistant instanceof HybridProvider) {
        try {
          const summary = await this.assistant.research(request, results, signal, onText);
          message = summary.message; provider = summary.provider;
        } catch {
          signal?.throwIfAborted();
          message = 'Encontrei fontes na web, mas o resumo por IA está indisponível. Veja os resultados:\n\n' + message;
          onText?.(message.slice(0, 6000));
        }
      }
      if (found.length < tried.length) message += '\n\nAlgumas consultas não retornaram fontes válidas; a resposta usa somente as fontes encontradas.';
      return { message, provider, command: 'search' as const, sources, webSearch: results.info };
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); this.active--; }
  }
}
