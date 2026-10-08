import { describe, expect, it } from 'vitest';
import { BrowserNoteStore } from './browser';
import { LocalProvider } from '../../shared/local';

function memory() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}
describe('notas no navegador para GitHub Pages', () => {
  it('persiste entre instâncias e isola sessões', () => {
    const storage = memory();
    new BrowserNoteStore(storage).add('a', 'Revisar portfólio');
    const reopened = new BrowserNoteStore(storage);
    expect(reopened.list('a')).toEqual([{ content: 'Revisar portfólio' }]);
    expect(reopened.list('b')).toEqual([]);
    expect(reopened.clear('a')).toBe(1);
    expect(reopened.list('a')).toEqual([]);
  });
  it('reutiliza o motor de comandos do backend', async () => {
    const provider = new LocalProvider(new BrowserNoteStore(memory()));
    const body = { sessionId: 'a', timeZone: 'America/Sao_Paulo', message: 'calcular 3 * 4' };
    expect((await provider.respond(body)).message).toBe('O resultado é 12.');
    await provider.respond({ ...body, message: 'anotar estudar React' });
    expect((await provider.respond({ ...body, message: 'notas' })).message).toContain('estudar React');
  });
  it('informa falha de quota, sem confirmar salvamento', () => {
    const storage = memory();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => new BrowserNoteStore(storage).add('a', 'Nota')).toThrow('Não foi possível salvar');
  });
  it('não sobrescreve dados corrompidos', () => {
    const storage = memory();
    storage.setItem('jarvis.notes.v1.a', 'broken-json');
    expect(() => new BrowserNoteStore(storage).add('a', 'Nova nota')).toThrow('Não foi possível ler');
    expect(storage.getItem('jarvis.notes.v1.a')).toBe('broken-json');
  });
  it('limita a 100 notas por sessão', () => {
    const store = new BrowserNoteStore(memory());
    for (let i = 0; i < 100; i++) expect(store.add('a', `Nota ${i}`)).toBe(true);
    expect(store.add('a', 'Excesso')).toBe(false);
  });
});
