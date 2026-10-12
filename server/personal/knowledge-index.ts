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
    for (const excerpt of passages(text)) result.push({ heading, excerpt, order: result.length });
  };
  for (const line of markdownBody(note.content).split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    const title = !fenced ? line.match(/^#{1,6}\s+(.+)/)?.[1] : undefined;
    if (title) { flush(); heading = prose(title).slice(0, 150); continue; }
    buffer += line + '\n';
  }
  flush(); return result;
}
// Keep complete table rows and repeat their headers. Cutting at an arbitrary
// character loses the final goals or separates a status from its own goal.
function passages(text: string): string[] {
  const result: string[] = []; const lines = text.split('\n'); let ordinary = '';
  const flush = () => { for (let start = 0; start < ordinary.length; start += 900) { const excerpt = ordinary.slice(start, start + 1100).trim(); if (excerpt) result.push(excerpt); } ordinary = ''; };
  const cells = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|') ? line.trim().slice(1, -1).split('|').map(cell => cell.trim()) : [];
  for (let index = 0; index < lines.length; index++) {
    const fence = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      flush(); const marker = fence[1]; const code: string[] = [];
      while (++index < lines.length) {
        const end = lines[index].match(/^\s*(`{3,}|~{3,})\s*$/)?.[1];
        if (end && end[0] === marker[0] && end.length >= marker.length) break;
        code.push(lines[index]);
      }
      // Every extracted code fragment keeps a fence, even across chunk limits.
      // Example tables in code are never promoted to personal goals.
      const block = code.join('\n');
      for (let start = 0; start < block.length; start += 850) result.push('```\n' + block.slice(start, start + 1050) + '\n```');
      continue;
    }
    const columns = cells(lines[index]); const separator = cells(lines[index + 1] ?? '');
    if (!columns.length || separator.length !== columns.length || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) { ordinary += lines[index] + '\n'; continue; }
    flush(); const header = lines[index] + '\n' + lines[++index]; let table = header;
    while (index + 1 < lines.length && cells(lines[index + 1]).length === columns.length && !cells(lines[index + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const nextSeparator = cells(lines[index + 2] ?? '');
      if (nextSeparator.length === columns.length && nextSeparator.every(cell => /^:?-{3,}:?$/.test(cell))) break;
      const row = lines[++index];
      if (header.length + row.length + 1 > 1100) { if (table !== header) result.push(table); table = header; continue; }
      if (table.length + row.length + 1 > 1100) { result.push(table); table = header; }
      table += '\n' + row;
    }
    if (table !== header) result.push(table);
  }
  flush(); return result;
}
const stop = new Set('a o as os e de do da dos das em no na nos nas para por com que qual quais como eu meu minha meus minhas me voce jarvis oi ola sobre quero saber ja foi sao uma um umas uns isso este esta esses essas ser ter tem tenho pode poderia favor favorzinho segundo cerebro obsidian cofre vault biblioteca nota notas anotacao anotacoes arquivo arquivos consultar consulte pesquise pesquisa pesquisar procure busque buscar mostre mostrar explique resumo resuma estudei estudos aprendi lembra lembrar'.split(' '));
for (const word of 'sim nao ok certo claro quando vai acontece acontecer ocorreu ocorrer agora hoje poderia consegue faca fazer devo'.split(' ')) stop.add(word);
// A small, explicit vocabulary joins common ways of asking about the same
// personal records. It changes retrieval only; excerpts remain the real text.
const equivalents = new Map([
  ...['meta', 'objetivo', 'goal', 'plano', 'planejamento'].map(word => [word, 'objetivo'] as const),
  ...['tarefa', 'pendencia', 'etapa', 'passo', 'task'].map(word => [word, 'tarefa'] as const),
  ...['prazo', 'horizonte', 'deadline', 'cronograma'].map(word => [word, 'prazo'] as const),
]);
const terms = (value: string) => normalizeKnowledge(value).replace(/\b(?:inteligencia artificial|artificial intelligence|ia|ai)\b/g, ' inteligenciaartificial ')
  .match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length >= 2 && !stop.has(word)).map(word => {
    const singular = word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;
    return equivalents.get(singular) ?? singular;
  }) ?? [];
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
  // Do not fill five slots with weak unrelated matches. A second strong
  // passage from the actual note is more useful than an unrelated fifth note.
  const threshold = (scored[0]?.score ?? 0) * .35;
  for (const entry of scored) if (picked.length < 5 && entry.score >= threshold && picked.filter(item => item.note.id === entry.note.id).length < 2) picked.push(entry);
  // A later correction in the same note can supersede an otherwise strong
  // old passage. Include the most recent correction section alongside it.
  for (const id of [...new Set(picked.map(entry => entry.note.id))]) {
    const indexedNote = indexed.find(item => item.note.id === id)!;
    const latest = indexedNote.entries.filter(entry => /\b(?:atualizacao|correcao|retificacao|estado atual)\b/.test(normalizeKnowledge(entry.heading))).sort((a, b) => b.order - a.order)[0];
    const update = latest ? { ...latest, note: indexedNote.note, score: 0 } : undefined;
    if (!update || picked.some(entry => entry.note.id === id && entry.order === update.order)) continue;
    if (picked.length >= 5) picked.pop();
    picked.push(update);
  }
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
