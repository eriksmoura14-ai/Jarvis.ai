import { LocalProvider } from '../../shared/local';
import { MAX_MESSAGE_LENGTH, type ChatRequest, type ChatResponse, type NoteRepository } from '../../shared/contracts';
import { makeId } from './storage';

// Pages hosts static files only. This adapter keeps the same command engine without a server.
export class BrowserNoteStore implements NoteRepository {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}
  private key(sessionId: string) { return `jarvis.notes.v1.${sessionId}`; }
  list(sessionId: string): { content: string }[] {
    try {
      const source = this.storage.getItem(this.key(sessionId));
      if (!source) return [];
      if (source.length > 2_000_000) throw new Error('invalid');
      const notes: unknown = JSON.parse(source);
      if (!Array.isArray(notes) || notes.length > 100 || !notes.every(note => typeof note === 'string' && note.length <= MAX_MESSAGE_LENGTH)) throw new Error('invalid');
      return notes.map(content => ({ content }));
    } catch { throw new Error('Não foi possível ler as notas deste navegador. Confira as permissões de armazenamento.'); }
  }
  add(sessionId: string, content: string): boolean {
    const notes = this.list(sessionId);
    if (notes.length >= 100) return false;
    try { this.storage.setItem(this.key(sessionId), JSON.stringify([...notes.map(note => note.content), content])); }
    catch { throw new Error('Não foi possível salvar a nota. O armazenamento foi bloqueado ou está sem espaço.'); }
    return true;
  }
  clear(sessionId: string): number {
    const count = this.list(sessionId).length;
    try { this.storage.removeItem(this.key(sessionId)); }
    catch { throw new Error('Não foi possível apagar as notas deste navegador.'); }
    return count;
  }
}
export async function browserCommand(body: ChatRequest): Promise<ChatResponse> {
  if (!body.message.trim() || body.message.length > MAX_MESSAGE_LENGTH) throw new Error('Digite uma mensagem com até 2.000 caracteres.');
  let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  try { storage = window.localStorage; }
  catch {
    // Non-note commands still work with a blocked storage API.
    storage = {
      getItem() { throw new Error('Storage unavailable'); },
      setItem() { throw new Error('Storage unavailable'); },
      removeItem() { throw new Error('Storage unavailable'); },
    };
  }
  const provider = new LocalProvider(new BrowserNoteStore(storage));
  const response = await provider.respond(body);
  return { ...response, id: makeId(), createdAt: new Date().toISOString() };
}
