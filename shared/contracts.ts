export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_CONTEXT_MESSAGES = 10;
export const MAX_CONTEXT_CHARACTERS = 8000;
export type ProviderName = 'local' | 'groq' | 'ollama';
export interface ConversationTurn { role: 'user' | 'assistant'; content: string }
export interface ChatRequest {
  message: string;
  sessionId: string;
  timeZone: string;
  context?: ConversationTurn[];
}
export interface ChatResponse {
  id: string;
  message: string;
  command: 'help' | 'greeting' | 'time' | 'date' | 'calculate' | 'note-add' | 'note-list' | 'note-clear' | 'unknown' | 'conversation';
  provider: ProviderName;
  createdAt: string;
}
export interface HealthResponse { status: 'ok'; provider: ProviderName; version: string; ai?: { configured: true; provider: 'groq' | 'ollama'; model: string } }
export interface AssistantProvider {
  readonly name: ProviderName;
  respond(request: ChatRequest, signal?: AbortSignal): Promise<Omit<ChatResponse, 'id' | 'createdAt'>>;
}
export interface NoteRepository {
  add(sessionId: string, content: string): boolean;
  list(sessionId: string): { content: string }[];
  clear(sessionId: string): number;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  provider?: ProviderName;
}
