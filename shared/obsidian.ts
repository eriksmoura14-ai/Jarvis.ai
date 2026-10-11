import { MAX_KNOWLEDGE_NOTES, MAX_IMPORT_FILES, validMarkdownFiles, validMarkdownPath, pathKey, type MarkdownFile } from './knowledge.js';
// Includes JSON escaping of 250 KB of text and up to 1,000 paths/hashes.
export const MAX_SYNC_REQUEST_BYTES = 2_000_000;
export interface ObsidianDevice { id: string; name: string; createdAt: string; expires: number }
export interface SyncFile extends MarkdownFile { hash: string }
export interface SyncRequest {
  changes: (MarkdownFile & { baseHash: string | null })[];
  known: { path: string; hash: string }[];
}
export interface SyncConflict { path: string; reason: 'changed' | 'removed' | 'limit'; remote?: SyncFile }
export interface SyncResponse {
  acknowledged: { path: string; hash: string }[]; updates: SyncFile[]; conflicts: SyncConflict[]; libraryRevision: number;
}
export const normalizeMarkdown = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
export const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function restoredBaselines(value: unknown): Record<string, string> {
  if (!object(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => validMarkdownPath(entry[0]) && validHash(entry[1])).slice(0, MAX_KNOWLEDGE_NOTES));
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validSyncRequest(v: unknown): v is SyncRequest {
  if (!object(v) || Object.keys(v).some(key => !['changes', 'known'].includes(key)) || !Array.isArray(v.changes) || v.changes.length > MAX_IMPORT_FILES || !Array.isArray(v.known) || v.known.length > MAX_KNOWLEDGE_NOTES) return false;
  return (v.changes.length === 0 || validMarkdownFiles(v.changes.map(file => object(file) ? { path: file.path, content: file.content } : file)))
    && v.changes.every(file => object(file) && Object.keys(file).every(key => ['path', 'content', 'baseHash'].includes(key)) && (file.baseHash === null || validHash(file.baseHash)))
    && v.known.every(file => object(file) && Object.keys(file).every(key => ['path', 'hash'].includes(key)) && validMarkdownPath(file.path) && validHash(file.hash))
    && new Set(v.known.map(file => pathKey(file.path))).size === v.known.length;
}
export function validSyncResponse(v: unknown): v is SyncResponse {
  if (!object(v) || !Number.isSafeInteger(v.libraryRevision) || Number(v.libraryRevision) < 0 || !Array.isArray(v.acknowledged) || v.acknowledged.length > MAX_IMPORT_FILES || !Array.isArray(v.updates) || v.updates.length > MAX_IMPORT_FILES || !Array.isArray(v.conflicts) || v.conflicts.length > MAX_IMPORT_FILES) return false;
  const validFile = (file: unknown) => object(file) && validHash(file.hash) && validMarkdownFiles([{ path: file.path, content: file.content }]);
  return v.acknowledged.every(file => object(file) && validMarkdownPath(file.path) && validHash(file.hash))
    && v.updates.every(validFile) && v.conflicts.every(file => object(file) && validMarkdownPath(file.path) && ['changed', 'removed', 'limit'].includes(String(file.reason)) && (file.remote === undefined || validFile(file.remote)));
}
export function validVaultFolder(folder: string) {
  return folder === '' || folder.length <= 200 && !/[\\:\u0000-\u001f\u007f]/.test(folder) && folder.split('/').every(part => part.length > 0 && part.trim() === part && !part.startsWith('.'));
}
export function inVaultScope(path: string, folder: string) { return validMarkdownPath(path) && validVaultFolder(folder) && (!folder || path.startsWith(folder + '/')); }
