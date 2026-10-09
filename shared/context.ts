import { MAX_CONTEXT_CHARACTERS, MAX_CONTEXT_MESSAGES, MAX_MESSAGE_LENGTH, type ConversationTurn, type Message } from './contracts.js';

// Send only recent text; timestamps, session metadata and the welcome message stay out.
export function conversationContext(messages: Message[]): ConversationTurn[] {
  const result: ConversationTurn[] = [];
  let remaining = MAX_CONTEXT_CHARACTERS;
  for (const message of messages.slice().reverse()) {
    if (message.id === 'welcome' || !message.content.trim()) continue;
    const content = message.content.slice(0, Math.min(MAX_MESSAGE_LENGTH, remaining));
    if (!content) break;
    result.unshift({ role: message.role, content });
    remaining -= content.length;
    if (!remaining || result.length === MAX_CONTEXT_MESSAGES) break;
  }
  return result;
}
