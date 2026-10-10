import type { ChatRequest, WebSearchInfo } from '../shared/contracts.js';
import { searchQuery } from '../shared/search.js';

export interface AssistantInput extends ChatRequest {
  personalMemory?: string[];
  personalNotes?: string[];
  searchContext?: WebSearchInfo;
  publicSearchTerms?: string;
}
export interface SearchPlan { queries: string[]; news: boolean }
export const SEARCH_TOOL = { type: 'function', function: {
  name: 'search_web', description: 'Consulta informações públicas na web e devolve fontes reais. Use para notícias, fatos atuais, preços, fontes e pedidos de pesquisa, inclusive continuações sobre o último assunto público. Nunca consulta dados pessoais.',
  parameters: { type: 'object', additionalProperties: false, required: ['queries', 'news'], properties: {
    queries: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 300 } },
    news: { type: 'boolean', description: 'true somente quando o pedido exige notícias recentes (últimos sete dias), não explicações históricas.' },
  } },
} };
export const INTERPRETATION_PROMPT = `\nInterprete a intenção antes de responder. Para conversa, explicações estáveis e informações pessoais, responda normalmente usando o contexto e os dados pessoais disponíveis. Para notícias, informações atuais, links/fontes ou pedidos de pesquisa, solicite search_web; não responda por memória como se tivesse pesquisado. Você pode propor até três consultas complementares, curtas e específicas. Use somente assuntos públicos presentes no pedido atual ou no último assunto público de pesquisa fornecido, sem copiar memórias, notas, nomes ou dados privados para consultas. Reformule referências como "e sobre isso hoje?" usando esse assunto público. Se a referência for pessoal ou ambígua, responda ou peça esclarecimento, sem pesquisar. Não chame ferramentas para salvar, editar ou apagar dados. Nunca produza URLs como ferramentas. O servidor valida e executa a pesquisa; não afirme que já foi realizada antes de receber resultados.`;
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function personalQuestion(text: string) {
  return /\b(?:meu (?:nome|cpf|endereco|telefone)|minha (?:senha|conta)|minhas? (?:memorias?|notas?|anotacoes?|preferencias?|projetos?|tarefas?|pendencias?)|o que (?:eu )?(?:anotei|salvei)|sobre mim|voce lembra de mim)\b/.test(normalize(text));
}
const words = (text: string) => normalize(text)
  .replace(/\b(?:inteligencia artificial|artificial intelligence|ia|ai)\b/g, ' inteligenciaartificial ')
  .replace(/\b(?:ucrania|ucranian[oa]s?|ukraine|ukrainians?)\b/g, ' ucrania ')
  .replace(/\b(?:guerra|war)\b/g, ' guerra ')
  .match(/[\p{L}\p{N}]+/gu) ?? [];
const neutral = new Set('a o as os e de do da dos das em no na nos nas sobre para por com the of and in on for news noticias noticia ultimas ultimos recentes hoje today latest recent fontes source sources informacoes detalhes atual atualizacao update atualizacoes como qual quais quanto que esta estao acontecendo me mim voce jarvis oi ola poderia pode quero saber informe explique pesquisar pesquise pesquisa'.split(' '));

// A model may request only public subjects traceable to this turn or a previous real search.
// Private conversation history, memories and notes are never added to this allowlist.
export function validatedPlan(value: unknown, request: AssistantInput): SearchPlan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const plan = value as Partial<SearchPlan>;
  if (Object.keys(value).some(key => !['queries', 'news'].includes(key)) || typeof plan.news !== 'boolean'
    || !Array.isArray(plan.queries) || !plan.queries.length || plan.queries.length > 3 || personalQuestion(request.message)) return;
  const allowed = new Set(words(request.message + ' ' + (request.searchContext?.query ?? '') + ' ' + (request.publicSearchTerms ?? '')).filter(word => !neutral.has(word)));
  const privateWords = new Set(words([...(request.personalMemory ?? []), ...(request.personalNotes ?? []), ...(request.context ?? []).map(turn => turn.content)].join(' ')).filter(word => !neutral.has(word)));
  const queries: string[] = [];
  for (const query of plan.queries) {
    if (typeof query !== 'string' || !query.trim() || query.length > 300 || /https?:\/\/|[\r\n]/i.test(query)) return;
    const terms = words(query).filter(word => !neutral.has(word));
    if (!terms.length || !terms.some(word => allowed.has(word)) || terms.some(word => privateWords.has(word) && !allowed.has(word))) return;
    queries.push(query.trim());
  }
  const requestedNews = /\b(?:noticias?|news|manchetes|headlines)\b/.test(normalize(request.message));
  return { queries: [...new Set(queries)], news: plan.news || requestedNews };
}
export function selectedNotes(notes: { content: string }[], message: string): string[] {
  const terms = new Set(words(searchQuery({ message, webSearch: true }) ?? message).filter(word => !neutral.has(word)));
  return notes.map((note, index) => ({ content: note.content, index, score: words(note.content).filter(word => terms.has(word)).length }))
    .filter(note => note.score > 0 || personalQuestion(message)).sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 5).map(note => note.content.slice(0, 1000));
}
