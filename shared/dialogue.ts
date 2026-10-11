export const normalizeQuestion = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
  .replace(/^(?:(?:oi|ola)[, ]+)?jarvis[,.:!]?\s+/, '').replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
export function dailyPlanningQuestion(text: string) {
  return /^(?:(?:e |entao |por favor ))?(?:o que (?:eu )?(?:devo|vamos|vou|posso|preciso) (?:fazer|estudar)(?: hoje)?|(?:planeje|planejar|organize|organizar|monte|montar) (?:o )?meu dia|(?:meu )?plano (?:de hoje|do dia)|(?:quais (?:sao )?)?(?:as )?minhas (?:tres |3 )?prioridades (?:para )?hoje)$/.test(normalizeQuestion(text));
}
export function personalReferenceQuestion(text: string) {
  return dailyPlanningQuestion(text) || /\b(?:meus?|minhas?)\b|\b(?:quem sou eu|como me chamo|me conhece|lembra de mim|o que eu quero|sobre mim|o que (?:eu )?(?:anotei|salvei)|(?:no|do) obsidian)\b/.test(normalizeQuestion(text));
}
export function requestsStructuredReply(question: string) {
  return /\b(?:liste|listar|lista|topicos|bullet|tabela|checklist|passo a passo|em itens|em etapas)\b/.test(normalizeQuestion(question));
}
// Keep citations, paragraphs and code. The model supplies the wording;
// remove unsolicited list scaffolding without another inference.
export function conversationalReply(text: string, question: string) {
  if (requestsStructuredReply(question) || /```|~~~|^\s*\|/m.test(text)) return text;
  return text.replace(/(?:^|\n)(?:[ \t]*(?:[-*•]|\d+[.)])[ \t]+[^\n]+\n?)+/g, block => '\n\n' + block.trim().split('\n')
    .map(line => line.replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/, '').trim()).join(' ') + '\n\n')
    .replace(/^\s*#{1,6}[ \t]+(?:resumo|resposta|conclus[aã]o|principais pontos)[: \t]*\n/gim, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
