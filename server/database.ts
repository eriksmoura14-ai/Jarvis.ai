import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Note { id: number; content: string; created_at: string }
export class NoteStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notes_session ON notes(session_id);
      CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_documents (id TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL);
    `);
  }
  add(sessionId: string, content: string): boolean {
    if (this.list(sessionId).length >= 100) return false;
    this.db.prepare('INSERT INTO notes (session_id, content, created_at) VALUES (?, ?, ?)')
      .run(sessionId, content, new Date().toISOString());
    return true;
  }
  list(sessionId: string): Note[] {
    return this.db.prepare('SELECT id, content, created_at FROM notes WHERE session_id = ? ORDER BY id LIMIT 100')
      .all(sessionId) as unknown as Note[];
  }
  clear(sessionId: string): number {
    return Number(this.db.prepare('DELETE FROM notes WHERE session_id = ?').run(sessionId).changes);
  }
  claimAIRequest(day: string, limit: number): boolean {
    this.db.prepare('DELETE FROM ai_usage WHERE day < ?').run(day);
    return this.db.prepare(`INSERT INTO ai_usage (day, count) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET count = count + 1 WHERE count < ?`).run(day, limit).changes === 1;
  }
  close(): void { this.db.close(); }
  readDocument(key = 'owner'): { value: string; version: number } | undefined {
    return this.db.prepare('SELECT value, version FROM personal_documents WHERE id = ?').get(key) as { value: string; version: number } | undefined;
  }
  writeDocument(value: string, version: number, key = 'owner'): boolean {
    return this.db.prepare(`INSERT INTO personal_documents (id, value, version) VALUES (?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value, version = version + 1 WHERE version = ?`).run(key, value, version).changes === 1;
  }
}
