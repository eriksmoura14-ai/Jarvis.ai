import type { ChatRequest, ChatResponse } from '../../shared/contracts.js';
import type { PersonalStore } from './store.js';

export async function memoryCommand(request: ChatRequest, store: PersonalStore): Promise<Omit<ChatResponse, 'id' | 'createdAt'> | undefined> {
  const input = request.message.trim().replace(/^jarvis[,.:!]?\s+/i, '');
  const normalized = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[?!.,]+$/g, '');
  const reply = (message: string) => ({ message, command: 'memory' as const, provider: 'local' as const });
  const memory = input.match(/^(?:lembre(?:-se)?(?: que)?|lembrar(?: que)?|memorize)\s+(.+)$/is);
  if (memory) {
    const content = memory[1].trim();
    if (content.length > 500) return reply('Use uma memória com até 500 caracteres.');
    await store.remember(content);
    return reply(`Memória salva: ${content}. Você pode consultar e apagar em “Memória pessoal”.`);
  }
  if (/^(memorias|minhas memorias|o que voce (lembra|sabe) (de|sobre) mim)$/.test(normalized)) {
    const { memories } = await store.snapshot();
    return reply(memories.length ? `Suas memórias:\n\n${memories.map((memory, index) => `${index + 1}. ${memory.content}`).join('\n')}` : 'Ainda não tenho memórias suas. Diga “lembre que prefiro respostas curtas” para salvar uma.');
  }
  if (normalized === 'apagar memorias') {
    await store.forgetAll(); return reply('Suas memórias pessoais foram apagadas. O histórico e as notas foram preservados.');
  }
}
