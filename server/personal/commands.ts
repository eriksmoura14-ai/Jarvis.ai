import type { ChatRequest, ChatResponse } from '../../shared/contracts.js';
import type { PersonalStore } from './store.js';
import { memorySlot, personalProfile } from '../../shared/memory.js';

interface PersonalCommand { response: Omit<ChatResponse, 'id' | 'createdAt'>; generation: number }
export async function memoryCommand(request: ChatRequest, store: PersonalStore): Promise<PersonalCommand | undefined> {
  const input = request.message.trim().replace(/^jarvis[,.:!]?\s+/i, '');
  const normalized = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[?!.,]+$/g, '');
  const reply = (message: string, generation: number, command: ChatResponse['command'] = 'memory'): PersonalCommand => ({ response: { message, command, provider: 'local' }, generation });
  const memory = input.match(/^(?:lembre(?:-se)?(?: que)?|lembrar(?: que)?|memorize)\s+(.+)$/is);
  if (normalized === 'apagar notas') {
    const { count, generation } = await store.clearWithReceipt();
    return reply(`${count} nota${count === 1 ? '' : 's'} excluída${count === 1 ? '' : 's'}.`, generation, 'note-clear');
  }
  if (memory || memorySlot(input)) {
    const content = memory ? memory[1].trim() : input;
    if (content.length > 500) return reply('Use uma memória com até 500 caracteres.', (await store.snapshot()).generation);
    const generation = await store.remember(content);
    return reply(`Memória salva: ${content}. Você pode consultar e apagar em “Memória pessoal”.`, generation);
  }
  if (/^(?:esqueca|esquecer|apague|apagar) (?:o )?meu nome$/.test(normalized)) {
    const profile = personalProfile((await store.snapshot()).memories);
    const generation = await store.saveProfile('', profile.address, profile);
    return reply('Seu nome foi removido do perfil e o contexto da conversa foi reiniciado. As mensagens antigas continuam visíveis no histórico.', generation);
  }
  const correction = input.match(/^(?:corrija|corrigir|atualize|atualizar)\s+(?:a\s+)?mem[oó]ria\s+(\d+)\s+para\s+(.+)$/is);
  const deletion = normalized.match(/^(?:apague|apagar|esqueca|esquecer)\s+(?:a\s+)?memoria\s+(\d+)$/);
  if (correction || deletion) {
    const { memories, generation } = await store.snapshot();
    const index = Number((correction ?? deletion)![1]) - 1;
    const existing = memories[index];
    if (!existing) return reply('Não encontrei esse número. Diga “minhas memórias” para consultar a lista atual.', generation);
    if (correction) {
      const updated = await store.edit(existing.id, correction[2].trim(), existing.content);
      return reply('Memória corrigida. Reiniciei o contexto da conversa para não reutilizar o conteúdo antigo.', updated);
    }
    const updated = await store.forget(existing.id);
    return reply('Memória apagada. Reiniciei o contexto da conversa. As mensagens antigas continuam visíveis no histórico.', updated);
  }
  if (/^(qual (e )?(o )?meu nome|como (eu )?me chamo|voce (sabe|lembra) (o )?meu nome)$/.test(normalized)) {
    const snapshot = await store.snapshot();
    const { name, address } = personalProfile(snapshot.memories);
    return reply(name ? `Seu nome é ${name}${address && address !== name ? `, ${address}` : ''}.` : 'Ainda não tenho seu nome salvo. Diga “meu nome é <nome>” ou preencha seu perfil em Memória pessoal.', snapshot.generation);
  }
  if (/^(oi|ola|bom dia|boa tarde|boa noite|jarvis)$/.test(normalized)) {
    const snapshot = await store.snapshot();
    const { name, address } = personalProfile(snapshot.memories);
    const salutation = /^(bom dia|boa tarde|boa noite)$/.test(normalized) ? input.replace(/[?!.,]+$/g, '') : 'Olá';
    return reply(`${salutation}${address || name ? `, ${address || name}` : ''}. Como posso ajudar hoje?`, snapshot.generation, 'greeting');
  }
  if (/^(memorias|minhas memorias|o que voce (lembra|sabe) (de|sobre) mim)$/.test(normalized)) {
    const { memories, generation } = await store.snapshot();
    return reply(memories.length ? `Suas memórias:\n\n${memories.map((memory, index) => `${index + 1}. ${memory.content}`).join('\n')}` : 'Ainda não tenho memórias suas. Diga “lembre que prefiro respostas curtas” para salvar uma.', generation);
  }
  if (normalized === 'apagar memorias') {
    const generation = await store.forgetAll(); return reply('Suas memórias pessoais foram apagadas e o contexto da conversa foi reiniciado. O histórico visível e as notas foram preservados.', generation);
  }
}
