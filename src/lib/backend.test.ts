import { describe, expect, it } from 'vitest';
import { normalizeBackend } from './backend';
describe('endereço do backend', () => {
  it('aceita HTTPS e localhost sem incluir credenciais', () => {
    expect(normalizeBackend(' https://jarvis.example/ ')).toBe('https://jarvis.example');
    expect(normalizeBackend('http://localhost:3001')).toBe('http://localhost:3001');
    expect(normalizeBackend('')).toBe('');
  });
  it.each(['http://192.168.1.10:3001', 'javascript:alert(1)', 'https://user:password@api.example', 'https://api.example/api', 'https://api.example?key=secret', 'https://api.example/#token', 'invalid'])('rejeita endereço inseguro ou ambíguo %s', value => {
    expect(() => normalizeBackend(value)).toThrow();
  });
});
