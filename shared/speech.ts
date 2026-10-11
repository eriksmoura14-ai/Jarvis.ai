export const MAX_SPEECH_CHARACTERS = 1200;
export type SpeechProfile = 'natural' | 'british' | 'jarvis-br';
export interface SpeechOptions { voiceId?: string; profile?: SpeechProfile }
export const VOICE_ID_PATTERN = /^[a-zA-Z0-9]{1,100}$/;
export interface SpeechVoice { id: string; name: string }
export interface SpeechVoiceCatalog { voices: SpeechVoice[]; matchedJarvis: boolean }
export interface SpeechQuota { used: number; limit: number; remaining: number; nextResetAt?: string }

// Read prose instead of markdown syntax, links and research reference numbers.
export function speechText(text: string) {
  const prose = text.replace(/```[\s\S]*?```/g, ' Trecho de código disponível no texto. ')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/\[(?:N)?\d+\]/g, '')
    .replace(/[*_`#]/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  if (prose.length <= MAX_SPEECH_CHARACTERS) return prose;
  const excerpt = prose.slice(0, MAX_SPEECH_CHARACTERS - 60);
  const boundary = excerpt.lastIndexOf(' ');
  return excerpt.slice(0, boundary > 0 ? boundary : excerpt.length) + '. A resposta completa está no texto.';
}

// At most two requests, with the same total character ceiling as a single reading.
export function speechParts(text: string): string[] {
  const prose = speechText(text);
  const match = prose.match(/^.{60,280}?[.!?](?:\s|$)/);
  if (!match || prose.length - match[0].length < 60) return prose ? [prose] : [];
  return [match[0].trim(), prose.slice(match[0].length).trim()];
}
