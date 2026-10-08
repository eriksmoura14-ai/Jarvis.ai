import type { ChatRequest, ChatResponse } from '../../shared/contracts.js';

// Future providers can be injected into buildApp. Keys and model requests stay on the server.
export interface AssistantProvider {
  readonly name: string;
  respond(request: ChatRequest): Promise<Omit<ChatResponse, 'id' | 'createdAt'>>;
}
