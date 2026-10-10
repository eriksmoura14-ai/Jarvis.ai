export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_CONTEXT_MESSAGES = 10;
export const MAX_CONTEXT_CHARACTERS = 8000;
export type ProviderName = 'local' | 'groq' | 'ollama';
export interface ConversationTurn { role: 'user' | 'assistant'; content: string }
export interface SearchSource { title: string; url: string; snippet: string }
export interface WebSearchInfo { query: string; engine: 'duckduckgo' | 'bing'; searchedAt: string }
export interface ChatRequest {
  message: string;
  sessionId: string;
  timeZone: string;
  context?: ConversationTurn[];
  webSearch?: boolean;
}
export interface ChatResponse {
  id: string;
  message: string;
  command: 'help' | 'greeting' | 'time' | 'date' | 'calculate' | 'note-add' | 'note-list' | 'note-clear' | 'unknown' | 'conversation' | 'search';
  provider: ProviderName;
  createdAt: string;
  sources?: SearchSource[];
  webSearch?: WebSearchInfo;
}
export interface HealthResponse { status: 'ok'; provider: ProviderName; version: string; revision?: string; ai?: { configured: true; provider: 'groq' | 'ollama'; model: string }; webSearch?: { enabled: true } }
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
  sources?: SearchSource[];
  webSearch?: WebSearchInfo;
}
