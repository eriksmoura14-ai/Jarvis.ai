import { describe, expect, it } from 'vitest';
import { resolveConversation } from './conversation.js';
import type { ConversationTurn } from '../shared/contracts.js';
const history = (...messages: string[]): ConversationTurn[] => messages.map(content => ({ role: 'user', content }));
describe('continuidade e fonte da conversa', () => {
  it.each(['no Obsidian', 'Não, no meu cofre', 'nas minhas notas'])('retoma o assunto ao corrigir a fonte: %s', message => {
    expect(resolveConversation(history('Me explique React'), message)).toMatchObject({ subject: 'Me explique React', knowledgeOnly: true, privateOnly: true });
    expect(resolveConversation([], message).clarification).toContain('Qual assunto ou nota');
  });
  it.each(['Explique melhor', 'Resuma', 'Mais curto', 'Dê um exemplo', 'Continue'])('transforma a conversa sem forçar outra pesquisa: %s', message => {
    expect(resolveConversation(history('Me explique React'), message)).toMatchObject({ subject: 'Me explique React', privateOnly: true, knowledgeOnly: false });
  });
  it('acompanha continuações encadeadas e abandona o assunto anterior quando surge outro', () => {
    expect(resolveConversation(history('React no meu Obsidian', 'Explique melhor', 'Resuma'), 'Dê um exemplo')).toMatchObject({ subject: 'React no meu Obsidian', knowledgeOnly: true });
    expect(resolveConversation(history('React no meu Obsidian'), 'Agora me explique Docker')).toMatchObject({ knowledgeOnly: false, privateOnly: false });
    expect(resolveConversation(history('React no meu Obsidian', 'Agora me explique Docker'), 'Resuma')).toMatchObject({ subject: 'Agora me explique Docker', knowledgeOnly: false });
  });
  it('protege planos pessoais em continuações e pede tema público para mudar a fonte', () => {
    expect(resolveConversation(history('Quais são minhas prioridades?'), 'E como faço isso?').privateOnly).toBe(true);
    expect(resolveConversation(history('Quais são minhas prioridades?'), 'na web').clarification).toContain('Qual tema público');
    expect(resolveConversation(history('Pesquise notícias de IA'), 'O que mudou nisso hoje?').privateOnly).toBe(false);
  });
  it('não inventa assunto após cumprimento ou sem contexto', () => {
    expect(resolveConversation(history('Oi'), 'no Obsidian').subject).toBeUndefined();
    expect(resolveConversation([], 'Resuma').clarification).toContain('Qual assunto');
  });
  it.each(['E qual o próximo passo?', 'Por onde começo?', 'E qual o prazo?', 'Em que etapa estamos?'])('mantém o objetivo e a fonte pessoal numa pergunta natural: %s', message => {
    const context = history('Quais são meus objetivos no Obsidian?', 'Explique melhor');
    expect(resolveConversation(context, message, true)).toMatchObject({ subject: 'Quais são meus objetivos no Obsidian?', knowledgeOnly: true, privateOnly: true });
    expect(resolveConversation(history('Oi'), message).clarification).toContain('De qual objetivo');
    expect(resolveConversation(context, 'Qual o próximo passo para aprender Docker?')).toMatchObject({ knowledgeOnly: false, subject: undefined });
  });
  it('mantém propostas de projetos privadas mesmo quando o texto menciona novidades', () => {
    expect(resolveConversation([], 'Crie um projeto para estudar as últimas novidades de IA').privateOnly).toBe(true);
    expect(resolveConversation(history('Crie um projeto para estudar as últimas novidades de IA'), 'E qual o prazo?').privateOnly).toBe(true);
    expect(resolveConversation([], 'Pesquise notícias de projetos de IA').privateOnly).toBe(false);
  });
});
