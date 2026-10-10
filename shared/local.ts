import type { AssistantProvider, ChatRequest, ChatResponse, NoteRepository } from './contracts.js';
import { calculate } from './calculator.js';

export const HELP = 'Posso ajudar com estes comandos:\n\n• hora — horário no seu fuso\n• data — data de hoje\n• calcular (12 + 8) / 2 — operações matemáticas\n• anotar comprar leite — guardar uma nota\n• notas — consultar suas notas\n• apagar notas — excluir todas as suas notas\n\nFunciono com comandos locais. Ainda não uso um modelo de IA nem acesso seu dispositivo.';

export class LocalProvider implements AssistantProvider {
  readonly name = 'local';
  constructor(private notes: NoteRepository, private now: () => Date = () => new Date()) {}
  async respond({ message, sessionId, timeZone }: ChatRequest) {
    const input = message.trim().replace(/^jarvis[,.:!]?\s+/i, '');
    const normalized = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[?!.,]+$/g, '');
    const reply = (text: string, command: ChatResponse['command']) => ({ message: text, command, provider: 'local' as const });
    if (/^(ajuda|help|comandos|o que voce (faz|pode fazer))$/.test(normalized)) return reply(HELP, 'help');
    if (/^(oi|ola|bom dia|boa tarde|boa noite|jarvis)$/.test(normalized)) return reply('Olá! Estou por aqui. Posso informar a hora, fazer cálculos e guardar suas notas. Como posso ajudar?', 'greeting');
    if (/^(hora|horas|que horas sao|qual (e )?a hora|horario)$/.test(normalized)) {
      return reply(`Agora são ${new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone }).format(this.now())} (${timeZone}).`, 'time');
    }
    if (/^(data|hoje|que dia e hoje|qual (e )?a data( de hoje)?)$/.test(normalized)) {
      return reply(`Hoje é ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeZone }).format(this.now())}.`, 'date');
    }
    const arithmetic = input.match(/^(?:calcular|calcule|quanto [ée])\s+(.+)$/i);
    if (arithmetic) {
      const numbers: Record<string, string> = { zero: '0', um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5', seis: '6', sete: '7', oito: '8', nove: '9', dez: '10' };
      const expression = arithmetic[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/\b(multiplicado por|vezes)\b/g, '*').replace(/\bdividido por\b/g, '/')
        .replace(/\bmais\b/g, '+').replace(/\bmenos\b/g, '-').replace(/\bvirgula\b/g, ',')
        .replace(/\b(zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/g, word => numbers[word])
        .replace(/[?!.]+$/g, '');
      try { return reply(`O resultado é ${calculate(expression).toLocaleString('pt-BR', { maximumSignificantDigits: 12 })}.`, 'calculate'); }
      catch (error) { return reply(error instanceof Error ? error.message : 'Não consegui calcular.', 'calculate'); }
    }
    const note = input.match(/^(?:anotar|anote|nota)\s+(.+)$/is);
    if (note) return reply(await this.notes.add(sessionId, note[1].trim()) ? `Nota salva: ${note[1].trim()}` : 'Você atingiu o limite de 100 notas. Use “apagar notas” para liberar espaço.', 'note-add');
    if (/^(notas|minhas notas|listar notas)$/.test(normalized)) {
      const notes = await this.notes.list(sessionId);
      return reply(notes.length ? `Suas notas:\n\n${notes.map((entry, i) => `${i + 1}. ${entry.content}`).join('\n')}` : 'Você ainda não tem notas. Experimente “anotar comprar leite”.', 'note-list');
    }
    if (normalized === 'apagar notas') {
      const count = await this.notes.clear(sessionId);
      return reply(`${count} nota${count === 1 ? '' : 's'} excluída${count === 1 ? '' : 's'}.`, 'note-clear');
    }
    return reply('Ainda não entendo esse pedido. Nesta versão, uso comandos locais e não um modelo de IA. Digite “ajuda” para ver o que posso fazer.', 'unknown');
  }
}
