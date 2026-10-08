import { describe, expect, it } from 'vitest';
import { decodeHistory } from './storage';

const message = { id: '1', role: 'assistant', content: 'Olá', createdAt: '2026-10-08T12:00:00Z' };
describe('histórico do navegador', () => {
  it('restaura mensagens válidas e preserva o texto como dado', () => {
    expect(decodeHistory(JSON.stringify([message, { ...message, id: '2', content: '<script>alert(1)</script>' }]))).toHaveLength(2);
  });
  it.each([null, 'broken-json', '{}', '[null,1,"text"]', JSON.stringify([{ ...message, role: 'system' }, { ...message, createdAt: 'invalid' }])])('ignora dados inválidos %s', source => {
    expect(decodeHistory(source)).toEqual([]);
  });
  it('retém apenas as 100 mensagens mais recentes', () => {
    const result = decodeHistory(JSON.stringify(Array.from({ length: 105 }, (_, i) => ({ ...message, id: String(i) }))));
    expect(result).toHaveLength(100);
    expect(result[0].id).toBe('5');
  });
});
