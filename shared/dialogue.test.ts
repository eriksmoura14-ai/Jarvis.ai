import { describe, expect, it } from 'vitest';
import { conversationalReply, dailyPlanningQuestion } from './dialogue.js';
import { automaticSearchQuery } from './search.js';

describe('intenção automática e formato de conversa', () => {
  it.each(['Qual o preço do PS5 hoje?', 'Últimas notícias tecnologia e IA', 'Clima em São Paulo', 'Jarvis, pesquise sobre a guerra na Ucrânia', 'Qual é a versão atual do React?'])('reconhece informação pública que exige consulta: %s', message => {
    expect(automaticSearchQuery(message)).toBeTruthy();
  });
  it.each(['Quais são meus futuros objetivos?', 'Pesquise minhas notas do Obsidian', 'Quem sou eu?', 'Agora me explique React', 'Que horas são agora?', 'O que é uma notícia?', 'Anotar pesquisar preços hoje', 'E o que mudou nisso hoje?', 'Bom dia'])('mantém assuntos pessoais, estáveis e referências ambíguas fora da busca automática: %s', message => {
    expect(automaticSearchQuery(message)).toBeUndefined();
  });
  it.each(['Planeje meu dia', 'Oi, Jarvis, o que vamos fazer hoje?', 'Quais são minhas prioridades hoje?', 'O que eu devo estudar hoje?'])('identifica planejamento sem confundir uma pergunta geral: %s', message => {
    expect(dailyPlanningQuestion(message)).toBe(true);
  });
  it('remove listas não pedidas preservando o texto e as citações', () => {
    expect(conversationalReply('## Resumo\n- React mudou [1].\n- TypeScript também [2].\n\nIsso facilita o trabalho.', 'Novidades de React?'))
      .toBe('React mudou [1]. TypeScript também [2].\n\nIsso facilita o trabalho.');
    expect(conversationalReply('1. Primeira ideia [N1].\n2. Segunda ideia [N2].', 'Quais são meus objetivos?')).toBe('Primeira ideia [N1]. Segunda ideia [N2].');
  });
  it('mantém listas e tabelas solicitadas, código e sinais que não sejam marcadores', () => {
    const list = '- React [1]\n- TypeScript [2]';
    expect(conversationalReply(list, 'Liste as novidades em tópicos')).toBe(list);
    const code = '```ts\nconst a = 1;\n```\n- Explicação';
    expect(conversationalReply(code, 'Explique o código')).toBe(code);
    expect(conversationalReply('2.5 é um número.\n-3 é negativo.', 'Explique números')).toBe('2.5 é um número.\n-3 é negativo.');
  });
});
