export const MAX_KNOWLEDGE_NOTES = 100;
export const MAX_NOTE_BYTES = 50_000;
export const MAX_LIBRARY_BYTES = 1_000_000;
export const MAX_IMPORT_FILES = 20;
export const MAX_IMPORT_BYTES = 250_000;
export interface MarkdownFile { path: string; content: string }
export interface KnowledgeNoteSummary { id: string; path: string; title: string; bytes: number; revision: number; updatedAt: string }
export interface KnowledgeNote extends KnowledgeNoteSummary { content: string }
export interface KnowledgeSource { reference: string; id: string; revision: number; title: string; path: string; heading: string; excerpt: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;
export const pathKey = (path: string) => path.normalize('NFC').toLocaleLowerCase('pt-BR');
export function validMarkdownPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 && /\.md$/i.test(value)
    && !/[\\:\u0000-\u001f\u007f]/.test(value) && value.split('/').every(part => !!part.trim() && part === part.trim() && !part.startsWith('.'));
}
export function validMarkdownFiles(value: unknown): value is MarkdownFile[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_IMPORT_FILES
    && value.every(file => object(file) && Object.keys(file).every(key => ['path', 'content'].includes(key)) && validMarkdownPath(file.path)
      && typeof file.content === 'string' && !!file.content.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(file.content) && byteLength(file.content) <= MAX_NOTE_BYTES)
    && value.reduce((sum, file) => sum + byteLength(file.content), 0) <= MAX_IMPORT_BYTES
    && new Set(value.map(file => pathKey(file.path))).size === value.length;
}
export function validKnowledgeSummary(value: unknown): value is KnowledgeNoteSummary {
  return object(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 36 && validMarkdownPath(value.path)
    && typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 150 && Number.isSafeInteger(value.bytes) && Number(value.bytes) > 0 && Number(value.bytes) <= MAX_NOTE_BYTES
    && Number.isSafeInteger(value.revision) && Number(value.revision) > 0 && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt));
}
export function validKnowledgeList(value: unknown): value is KnowledgeNoteSummary[] {
  return Array.isArray(value) && value.length <= MAX_KNOWLEDGE_NOTES && value.every(validKnowledgeSummary)
    && value.reduce((sum, note) => sum + note.bytes, 0) <= MAX_LIBRARY_BYTES;
}
export function validKnowledgeSources(value: unknown): value is KnowledgeSource[] {
  return Array.isArray(value) && value.length <= 5 && value.every(source => object(source) && /^N[1-5]$/.test(String(source.reference))
    && typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 36 && Number.isSafeInteger(source.revision) && Number(source.revision) > 0
    && validMarkdownPath(source.path) && typeof source.title === 'string' && source.title.length > 0 && source.title.length <= 150
    && typeof source.heading === 'string' && source.heading.length <= 150 && typeof source.excerpt === 'string' && source.excerpt.length > 0 && source.excerpt.length <= 1200)
    && new Set(value.map(source => source.reference)).size === value.length;
}
export const normalizeKnowledge = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function knowledgeQuestion(message: string) {
  return /\b(?:meu|minha|meus|minhas|no|do|na|da) (?:obsidian|cofre|vault|biblioteca)\b|\b(?:notas|anotacoes|arquivos) (?:do|no) obsidian\b|\b(?:o que (?:eu )?(?:ja )?(?:estudei|escrevi)|nos meus estudos|nas minhas anotacoes)\b/.test(normalizeKnowledge(message));
}
