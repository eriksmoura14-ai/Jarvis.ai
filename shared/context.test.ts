import { describe, expect, it } from 'vitest';
import { conversationContext } from './context.js';
import type { Message } from './contracts.js';
const message = (id: string, content: string, role: Message['role'] = 'user'): Message => ({ id, content, role, createdAt: new Date().toISOString() });
describe('contexto recente', () => {
  it('preserva ordem, respostas e perguntas sem incluir boas-vindas ou metadados', () => {
    expect(conversationContext([message('welcome', 'Olá'), message('1', 'Explique React'), message('2', 'É uma biblioteca.', 'assistant')]))
      .toEqual([{ role: 'user', content: 'Explique React' }, { role: 'assistant', content: 'É uma biblioteca.' }]);
  });
  it('limita mensagens e caracteres mantendo as mais recentes', () => {
    expect(conversationContext(Array.from({ length: 15 }, (_, i) => message(String(i), String(i))))).toHaveLength(10);
    const context = conversationContext(Array.from({ length: 15 }, (_, i) => message(String(i), String(i).repeat(3000))));
    expect(context.reduce((size, entry) => size + entry.content.length, 0)).toBe(8000);
    expect(context.at(-1)?.content.startsWith('14')).toBe(true);
    expect(context.every(entry => entry.content.length <= 2000)).toBe(true);
  });
});
