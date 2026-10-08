export const MAX_MESSAGE_LENGTH = 2000;
export interface ChatRequest {
  message: string;
  sessionId: string;
  timeZone: string;
}
export interface ChatResponse {
  id: string;
  message: string;
  command: 'help' | 'greeting' | 'time' | 'date' | 'calculate' | 'note-add' | 'note-list' | 'note-clear' | 'unknown';
  provider: 'local';
  createdAt: string;
}
export interface HealthResponse { status: 'ok'; provider: 'local'; version: string }
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
