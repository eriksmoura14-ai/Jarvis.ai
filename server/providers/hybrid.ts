import type { AssistantProvider, ChatRequest } from '../../shared/contracts.js';
import { LocalProvider } from './local.js';
import { ModelError, ModelProvider } from './model.js';
import type { SearchResults } from '../search.js';
import { validatedKnowledgePlan, type AssistantInput } from '../interpretation.js';

export class HybridProvider implements AssistantProvider {
  readonly name: 'groq' | 'ollama';
  private active = 0;
  private requests: number[] = [];
  private quotaPause?: { until: number; error: ModelError };
  constructor(private local: LocalProvider, readonly model: ModelProvider, private claimDailyRequest: (day: string) => boolean | Promise<boolean>) { this.name = model.name; }
  async respond(request: ChatRequest, signal?: AbortSignal, onText?: (text: string) => void) {
    const local = await this.local.respond(request);
    if (local.command !== 'unknown') {
      if (local.command === 'help') local.message = local.message.replace('Funciono com comandos locais. Ainda não uso um modelo de IA nem acesso seu dispositivo.', 'Esses comandos funcionam localmente. Não controlo seu dispositivo.')
        + '\n\nTambém posso conversar, ajudar com textos e estudos e interpretar pedidos de pesquisa usando o modelo configurado. Alterações de dados dependem de comandos explícitos.';
      return local;
    }
    return this.respondModel(request, signal, undefined, onText, true);
  }
  async research(request: ChatRequest, results: SearchResults, signal?: AbortSignal, onText?: (text: string) => void) {
    return this.respondModel(request, signal, results, onText);
  }
  async planResearch(request: AssistantInput, signal?: AbortSignal) {
    return this.respondModel(request, signal, undefined, undefined, true);
  }
  private async respondModel(request: AssistantInput, signal?: AbortSignal, research?: SearchResults, onText?: (text: string) => void, interpret = false): Promise<Awaited<ReturnType<ModelProvider['respond']>>> {
    if (this.active >= 2) throw new ModelError('A IA está ocupada. Aguarde um minuto ou use os comandos locais.', 429);
    this.active++;
    try {
      let recovered = false;
      const infer = async (input: AssistantInput, results?: SearchResults, tools = false) => {
        const run = async () => {
          signal?.throwIfAborted();
          const now = Date.now();
          // Respect a provider's Retry-After across turns and research passes.
          // When absent, a short local backoff prevents hammering; it does not
          // claim that the provider's quota resets after that interval.
          if (this.quotaPause && now < this.quotaPause.until) throw this.quotaPause.error;
          this.requests = this.requests.filter(time => now - time < 60_000);
          if (this.requests.length >= 6) throw new ModelError('A IA está ocupada. Aguarde um minuto ou use os comandos locais.', 429);
          this.requests.push(now);
          if (!await this.claimDailyRequest(new Date(now).toISOString().slice(0, 10))) throw new ModelError('O limite diário de IA deste servidor foi atingido. Os comandos locais continuam disponíveis.', 429);
          signal?.throwIfAborted();
          let result;
          try { result = await this.model.respond(input, signal, recovered ? undefined : onText, results, tools); }
          catch (error) {
            if (error instanceof ModelError && error.statusCode === 429) this.quotaPause = { until: Date.now() + Math.max(1000, error.retryAfterMs ?? 60_000), error };
            throw error;
          }
          if (recovered && result.message) onText?.(result.message);
          return result;
        };
        try { return await run(); }
        catch (error) {
          // One JSON recovery per response, including a subsequent read_notes
          // pass. Keep the tools and their validators; never execute failed tool
          // text or accept an unfinished stream as a completed answer.
          if (recovered || !onText || signal?.aborted || !(error instanceof ModelError) || !error.retryWithoutStream) throw error;
          recovered = true;
          return run();
        }
      };
      const response = await infer(request, research, interpret);
      if (!('knowledgePlan' in response)) return response;
      signal?.throwIfAborted();
      const plan = validatedKnowledgePlan(response.knowledgePlan, request);
      if (!plan || !request.readKnowledge) throw new ModelError('Não consegui identificar as notas solicitadas. Diga o título ou assunto.');
      const knowledgeContext = request.readKnowledge(plan);
      // Count the second inference against the same minute/day budget. No tool
      // is offered on this pass, so a model cannot loop or research private text.
      return await infer({ ...request, knowledgeContext, knowledgeOnly: true, privateOnly: true, readKnowledge: undefined });
    }
    finally { this.active--; }
  }
}
