import { describe, expect, it } from 'vitest';
import { MAX_SPEECH_CHARACTERS, speechText } from './speech';

describe('texto para voz por IA', () => {
  it('preserva frases e números, remove links, referências e markdown', () => {
    expect(speechText('**Resultado:** 12,5. [Fonte](https://example.com) [1] https://example.com/test')).toBe('Resultado: 12,5. Fonte');
    expect(speechText('Veja:\n```ts\nlet x = 1;\n```\nPronto.')).toBe('Veja: Trecho de código disponível no texto. Pronto.');
  });
  it('limita a leitura sem afirmar que leu a resposta inteira', () => {
    const text = speechText('Uma resposta longa. '.repeat(200));
    expect(text.length).toBeLessThanOrEqual(MAX_SPEECH_CHARACTERS);
    expect(text).toContain('A resposta completa está no texto.');
    expect(speechText('x'.repeat(2000)).length).toBeLessThanOrEqual(MAX_SPEECH_CHARACTERS);
  });
});
