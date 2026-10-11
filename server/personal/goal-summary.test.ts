import { describe, expect, it } from 'vitest';
import { recordedGoalsFallback } from './goal-summary.js';
import type { KnowledgeSource } from '../../shared/knowledge.js';

const question = 'quais sao meus futuros objetivos';
const refusal = 'Não tenho detalhes suficientes sobre os seus objetivos futuros. Você pode me dizer quais são ou indicar a nota onde eles estão descritos?';
const source: KnowledgeSource = { id: 'fixture-goal-id', revision: 1, reference: 'N2', title: 'Metas pessoais', path: 'Planejamento/Metas.md', heading: 'Metas registradas', excerpt: [
  '| Meta | Horizonte discutido | Situação recuperada |', '|---|---|---|',
  '| Aprender Rust | Ciclo a confirmar | Plano, sem curso concluído |',
  '| Documentar um projeto | Ano seguinte | Planejado, sem publicação confirmada |',
  '| Fazer o exercício anterior | Semana passada | Concluído |',
  '| Ler mais | Sem data | Não concluído |',
  '| Um item cortado | Um horizonte cortado',
].join('\n') };

describe('metas explícitas quando o modelo recusa os registros disponíveis', () => {
  it('extrai metas, horizontes e incertezas da tabela, com referência real', () => {
    const result = recordedGoalsFallback(question, refusal, [source]);
    expect(result).toContain('Aprender Rust — Horizonte registrado: Ciclo a confirmar. Situação registrada: Plano, sem curso concluído [N2]');
    expect(result).toContain('Planejado, sem publicação confirmada');
    expect(result).toContain('Ler mais'); expect(result).not.toContain('Fazer o exercício anterior');
    expect(result).not.toContain('Um item cortado'); expect(result).not.toContain('[N1]');
    expect(result).toContain('não uma confirmação'); expect(result).toContain('nem uma lista completa');
  });
  it.each(['Quando atingirei minhas metas?', 'Quais são minhas prioridades?', 'Quais são meus objetivos para 2030?', 'Quais são os objetivos da empresa?', 'Quais são meus objetivos profissionais?'])('não substitui uma pergunta mais específica por uma lista genérica: %s', message => {
    expect(recordedGoalsFallback(message, refusal, [source])).toBeUndefined();
  });
  it.each(['Aprender Rust é um plano, não um curso concluído [N2].', 'Não tenho dados sobre a prioridade, mas há metas registradas.', 'Não tenho detalhes suficientes sobre o prazo [N2].'])('preserva respostas fundamentadas ou parcialmente informativas: %s', answer => {
    expect(recordedGoalsFallback(question, answer, [source])).toBeUndefined();
  });
  it('mantém esclarecimento quando faltam registros explícitos ou a tabela é pública', () => {
    expect(recordedGoalsFallback(question, refusal, [])).toBeUndefined();
    expect(recordedGoalsFallback(question, refusal, [{ ...source, excerpt: 'Um artigo geral sobre aprendizagem.' }])).toBeUndefined();
    expect(recordedGoalsFallback(question, refusal, [{ ...source, title: 'Políticas nacionais', heading: 'Objetivos do programa público' }])).toBeUndefined();
    expect(recordedGoalsFallback(question, refusal, [{ ...source, excerpt: '| Meta | Status |\n|---|---|\n| Ler | Concluído |' }])).toBeUndefined();
    expect(recordedGoalsFallback(question, refusal, [{ ...source, excerpt: '| Meta | Status |\n|---|---|\n| - | A confirmar |' }])).toBeUndefined();
  });
  it('limita o tamanho sem cortar o status e sem repetir a mesma linha', () => {
    const many = { ...source, excerpt: '| Objetivo | Prazo | Status |\n|---|---|---|\n' + Array.from({ length: 30 }, (_, i) => `| Ler o capítulo ${i} | A confirmar | Planejado |`).join('\n') };
    const result = recordedGoalsFallback(question, refusal, [many, many])!;
    expect(result.length).toBeLessThan(4300); expect((result.match(/• /g) ?? []).length).toBe(10);
    expect(result.match(/capítulo 0 /g)).toHaveLength(1);
  });
  it('não transforma um exemplo dentro de código em uma meta pessoal', () => {
    expect(recordedGoalsFallback(question, refusal, [{ ...source, excerpt: '```markdown\n' + source.excerpt + '\n```' }])).toBeUndefined();
  });
  it('não interpreta cabeçalhos e separadores de tabelas adjacentes como metas', () => {
    const table = '| Meta | Status |\n|---|---|\n| Estudar testes | Planejado |';
    const result = recordedGoalsFallback(question, refusal, [{ ...source, excerpt: table + '\n' + table }])!;
    expect((result.match(/• /g) ?? []).length).toBe(1);
    expect(result).not.toContain('• Meta'); expect(result).not.toContain('• ---');
  });
});
