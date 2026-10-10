export const MAX_SPEECH_CHARACTERS = 1200;

// Read prose instead of markdown syntax, links and research reference numbers.
export function speechText(text: string) {
  const prose = text.replace(/```[\s\S]*?```/g, ' Trecho de código disponível no texto. ')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/\[\d+\]/g, '')
    .replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
  if (prose.length <= MAX_SPEECH_CHARACTERS) return prose;
  const excerpt = prose.slice(0, MAX_SPEECH_CHARACTERS - 60);
  const boundary = excerpt.lastIndexOf(' ');
  return excerpt.slice(0, boundary > 0 ? boundary : excerpt.length) + '. A resposta completa está no texto.';
}
