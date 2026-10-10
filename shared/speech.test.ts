import { describe, expect, it } from 'vitest';
import { MAX_SPEECH_CHARACTERS, speechText, speechParts } from './speech';

describe('texto para voz por IA', () => {
  it('preserva frases e números, remove links, referências e markdown', () => {
    expect(speechText('**Resultado:** 12,5. [Fonte](https://example.com) [1] https://example.com/test')).toBe('Resultado: 12,5. Fonte');
    expect(speechText('Veja:\n```ts\nlet x = 1;\n```\nPronto.')).toBe('Veja: Trecho de código disponível no texto. Pronto.');
    expect(speechText('Uma fonte [1]. Mais detalhes [2], se quiser.')).toBe('Uma fonte. Mais detalhes, se quiser.');
  });
  it('limita a leitura sem afirmar que leu a resposta inteira', () => {
    const text = speechText('Uma resposta longa. '.repeat(200));
    expect(text.length).toBeLessThanOrEqual(MAX_SPEECH_CHARACTERS);
    expect(text).toContain('A resposta completa está no texto.');
    expect(speechText('x'.repeat(2000)).length).toBeLessThanOrEqual(MAX_SPEECH_CHARACTERS);
  });
  it('divide somente em fim de frase, mantém aviso de corte e teto total, sem repetir texto', () => {
    const original = 'Uma primeira frase que explica a resposta com contexto suficiente para começar. ' + 'Uma continuação com os próximos passos e mais detalhes úteis. '.repeat(40);
    const parts = speechParts(original);
    expect(parts).toHaveLength(2); expect(parts.join(' ')).toBe(speechText(original));
    expect(parts.reduce((sum, part) => sum + part.length, 0)).toBeLessThanOrEqual(MAX_SPEECH_CHARACTERS);
    expect(parts[1]).toContain('A resposta completa está no texto.');
    expect(speechParts('Sem pontuação '.repeat(100))).toHaveLength(1);
    expect(speechParts('O resultado é 7.')).toEqual(['O resultado é 7.']);
  });
});
