import type { AssistantProvider, ChatRequest } from '../../shared/contracts.js';
import { LocalProvider } from './local.js';
import { ModelError, ModelProvider } from './model.js';

export class HybridProvider implements AssistantProvider {
  readonly name: 'groq' | 'ollama';
  private active = 0;
  private requests: number[] = [];
  constructor(private local: LocalProvider, readonly model: ModelProvider, private claimDailyRequest: (day: string) => boolean) { this.name = model.name; }
  async respond(request: ChatRequest, signal?: AbortSignal) {
    const local = await this.local.respond(request);
    if (local.command !== 'unknown') {
      if (local.command === 'help') local.message = local.message.replace('Funciono com comandos locais. Ainda não uso um modelo de IA nem acesso seu dispositivo.', 'Esses comandos funcionam localmente. Não controlo seu dispositivo.')
        + '\n\nTambém posso conversar e ajudar com textos e estudos usando o modelo configurado. Ainda não consulto a web nem executo ações por meio da IA.';
      return local;
    }
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < 60_000);
    if (this.active >= 2 || this.requests.length >= 6) throw new ModelError('A IA está ocupada. Aguarde um minuto ou use os comandos locais.', 429);
    if (!this.claimDailyRequest(new Date(now).toISOString().slice(0, 10))) throw new ModelError('O limite diário de IA deste servidor foi atingido. Os comandos locais continuam disponíveis.', 429);
    this.requests.push(now);
    this.active++;
    try { return await this.model.respond(request, signal); }
    finally { this.active--; }
  }
}
