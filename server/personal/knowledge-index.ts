import type { ChatResponse } from '../../shared/contracts.js';
import { knowledgeQuestion, normalizeKnowledge, type KnowledgeNote, type KnowledgeSource, type MarkdownFile } from '../../shared/knowledge.js';
import { resolveConversation } from '../conversation.js';
import type { ConversationTurn } from '../../shared/contracts.js';
import type { KnowledgePlan } from '../interpretation.js';

export function knowledgeFollowupSubject(context: { role: string; content: string }[], message: string) {
  const resolved = resolveConversation(context as ConversationTurn[], message);
  return resolved.knowledgeOnly ? resolved.subject ?? '' : '';
}

export function markdownBody(content: string) { return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, ''); }
function prose(text: string) {
  return text.replace(/!\[\[[^\]]+\]\]/g, '[anexo]')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias?: string) => alias ?? target)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[imagem]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/^[#>*]+\s*/gm, '').trim();
}
export function markdownTitle(file: MarkdownFile) {
  let fenced = false;
  for (const line of markdownBody(file.content).split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^#\s+\S/.test(line)) return prose(line).slice(0, 150);
  }
  return file.path.split('/').at(-1)!.replace(/\.md$/i, '').slice(0, 150) || 'Nota';
}
function chunks(note: KnowledgeNote) {
  const result: { heading: string; excerpt: string; order: number }[] = [];
  let heading = ''; let buffer = ''; let fenced = false;
  const flush = () => {
    const text = prose(buffer); buffer = '';
    for (let start = 0; start < text.length; start += 900) {
      const excerpt = text.slice(start, start + 1100).trim();
      if (excerpt) result.push({ heading, excerpt, order: result.length });
    }
  };
  for (const line of markdownBody(note.content).split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    const title = !fenced ? line.match(/^#{1,6}\s+(.+)/)?.[1] : undefined;
    if (title) { flush(); heading = prose(title).slice(0, 150); continue; }
    buffer += line + '\n';
  }
  flush(); return result;
}
const stop = new Set('a o as os e de do da dos das em no na nos nas para por com que qual quais como eu meu minha meus minhas me voce jarvis oi ola sobre quero saber ja foi sao uma um umas uns isso este esta esses essas ser ter tem tenho pode poderia favor favorzinho segundo cerebro obsidian cofre vault biblioteca nota notas anotacao anotacoes arquivo arquivos consultar consulte pesquise pesquisa pesquisar procure busque buscar mostre mostrar explique resumo resuma estudei estudos aprendi lembra lembrar'.split(' '));
const terms = (value: string) => normalizeKnowledge(value).replace(/\b(?:inteligencia artificial|artificial intelligence|ia|ai)\b/g, ' inteligenciaartificial ')
  .match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length >= 2 && !stop.has(word)).map(word => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word) ?? [];
export function knowledgeCatalog(notes: KnowledgeNote[], query: string) {
  const wanted = new Set(terms(query));
  const sorted = notes.map(note => ({ note, score: terms(note.title + ' ' + note.path).filter(term => wanted.has(term)).length }))
    .sort((a, b) => b.score - a.score || b.note.updatedAt.localeCompare(a.note.updatedAt));
  const catalog: { id: string; title: string; path: string }[] = [];
  let remaining = 8000;
  for (const { note } of sorted) {
    const entry = { id: note.id, title: note.title.slice(0, 80), path: note.path.slice(0, 100) };
    const length = JSON.stringify(entry).length + 1;
    if (length > remaining) continue;
    catalog.push(entry); remaining -= length;
  }
  return catalog;
}
export function readKnowledge(notes: KnowledgeNote[], plan: KnowledgePlan): KnowledgeSource[] {
  const selected = plan.noteIds.flatMap(id => notes.filter(note => note.id === id));
  const found = plan.query ? retrieveKnowledge(selected, plan.query) : [];
  // A selected title is a lead, not evidence. Return actual bounded text even
  // when the model's vocabulary differs from the note's vocabulary.
  for (const note of selected) {
    if (found.some(source => source.id === note.id) || found.length >= 5) continue;
    const chunk = chunks(note)[0];
    if (chunk) found.push({ reference: `N${found.length + 1}`, id: note.id, revision: note.revision, path: note.path, title: note.title, heading: chunk.heading, excerpt: chunk.excerpt });
  }
  return found.map((source, index) => ({ ...source, reference: `N${index + 1}` }));
}
export function retrieveKnowledge(notes: KnowledgeNote[], message: string): KnowledgeSource[] {
  const query = new Set(terms(message));
  if (!query.size) return [];
  const frequencies = new Map<string, number>();
  const indexed = notes.map(note => {
    const entries = chunks(note).map(chunk => ({ ...chunk, words: new Set(terms(chunk.excerpt + ' ' + chunk.heading)) }));
    const titleWords = new Set(terms(note.title + ' ' + note.path));
    const all = new Set([...titleWords, ...entries.flatMap(entry => [...entry.words])]);
    for (const word of query) if (all.has(word)) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    return { note, entries, titleWords };
  });
  const scored = indexed.flatMap(({ note, entries, titleWords }) => entries.map(entry => {
    let score = 0;
    for (const word of query) score += (entry.words.has(word) ? 1 : 0) * Math.log(1 + notes.length / (frequencies.get(word) ?? 1)) + (titleWords.has(word) ? 3 : 0);
    return { note, ...entry, score };
  })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || b.note.updatedAt.localeCompare(a.note.updatedAt) || a.order - b.order);
  const picked: typeof scored = [];
  // Cover distinct notes first, then allow a second relevant passage per note.
  for (const entry of scored) if (picked.length < 5 && !picked.some(item => item.note.id === entry.note.id)) picked.push(entry);
  for (const entry of scored) if (picked.length < 5 && !picked.includes(entry) && picked.filter(item => item.note.id === entry.note.id).length < 2) picked.push(entry);
  return picked.map((entry, index) => ({ reference: `N${index + 1}`, id: entry.note.id, revision: entry.note.revision, path: entry.note.path, title: entry.note.title, heading: entry.heading, excerpt: entry.excerpt }));
}
export function knowledgeReply(message: string, notes: KnowledgeNote[], sources: KnowledgeSource[], modelAvailable: boolean): Omit<ChatResponse, 'id' | 'createdAt'> | undefined {
  if (!knowledgeQuestion(message)) return;
  const normalized = normalizeKnowledge(message).trim().replace(/^jarvis[,.:!]?\s+/, '').replace(/[.!?]+$/, '');
  if (/^(?:(?:mostre|mostrar|liste|listar) (?:as? )?)?(?:(?:minhas |as )?notas (?:do|no) obsidian|(?:a )?(?:minha )?biblioteca|meu obsidian)$/.test(normalized)) return { provider: 'local', command: 'conversation', message: notes.length
    ? `${notes.length} nota(s) importada(s) do Obsidian:\n` + notes.slice(0, 20).map(note => `• ${note.title} — ${note.path}`).join('\n') + '\nDiga um tema ou título para eu consultar. Abra “Notas do Obsidian” para ver a biblioteca completa.'
    : 'Ainda não há notas importadas. Abra “Notas do Obsidian”, selecione arquivos .md e confirme a importação.' };
  if (!sources.length && (!modelAvailable || !notes.length)) return { provider: 'local', command: 'conversation', message: notes.length
    ? 'Não encontrei trechos das notas importadas com palavras desse assunto. Diga o tema ou o título da nota, ou use a busca em “Notas do Obsidian”. Não consultei a web.'
    : 'Ainda não há notas importadas. Abra “Notas do Obsidian”, selecione arquivos .md e confirme a importação.' };
  if (!modelAvailable) return { provider: 'local', command: 'knowledge', message: 'Encontrei estes trechos nas suas notas. O resumo por IA exige um modelo conectado:\n\n' + sources.map(source => `[${source.reference}] ${source.title}${source.heading ? ' · ' + source.heading : ''}\n${source.excerpt}`).join('\n\n') };
}
