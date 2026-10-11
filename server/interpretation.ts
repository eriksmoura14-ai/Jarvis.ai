import type { ChatRequest, WebSearchInfo } from '../shared/contracts.js';
import { searchQuery } from '../shared/search.js';
import { validChange, type PersonalProject, type ProjectChange } from '../shared/projects.js';
import { knowledgeQuestion, type KnowledgeSource } from '../shared/knowledge.js';

export interface AssistantInput extends ChatRequest {
  personalMemory?: string[];
  personalNotes?: string[];
  searchContext?: WebSearchInfo;
  publicSearchTerms?: string;
  projectData?: PersonalProject[];
  privateProjectTerms?: string;
  knowledgeContext?: KnowledgeSource[];
  privateKnowledgeTerms?: string;
  knowledgeOnly?: boolean;
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
  return knowledgeQuestion(text) || /\b(?:meu (?:nome|cpf|endereco|telefone)|minha (?:senha|conta)|(?:meus?|minhas?) (?:memorias?|notas?|anotacoes?|preferencias?|projetos?|tarefas?|pendencias?)|o que (?:eu )?(?:anotei|salvei)|sobre mim|voce lembra de mim)\b/.test(normalize(text));
}
export const PROJECT_TOOL = { type: 'function', function: {
  name: 'propose_project_change', description: 'Propõe criar um projeto com etapas, adicionar tarefas ou concluir uma tarefa existente. Nada é salvo antes de o dono revisar e confirmar na interface. Use para pedidos de planos pessoais e projetos/tarefas. Não pesquisa na internet.',
  parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
    action: { type: 'string', enum: ['create_project', 'add_tasks', 'complete_task'] },
    title: { type: 'string', maxLength: 100 }, description: { type: 'string', maxLength: 1000 },
    projectId: { type: 'string', description: 'ID exato do projeto fornecido nos dados atuais.' }, taskId: { type: 'string', description: 'ID exato da tarefa fornecida nos dados atuais.' },
    tasks: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', maxLength: 150 }, dueDate: { type: 'string', description: 'Prazo opcional YYYY-MM-DD; não invente datas que o dono não pediu.' } } } },
  } },
} };
export const PROJECT_PROMPT = '\nVocê pode propor mudanças em projetos usando propose_project_change. Para criar: action, title, description e tasks. Para adicionar: action, projectId e tasks. Para concluir: action, projectId e taskId. Use apenas IDs dos dados atuais e campos daquela ação. Peça esclarecimento quando não souber qual tarefa/projeto. Não afirme que salvou ou concluiu: somente a confirmação na interface executa a mudança. Não use search_web para consultar planos, etapas, projetos ou tarefas pessoais. Dados atuais prevalecem sobre o histórico. Não invente prazos. Até vinte etapas por proposta; tarefas e projetos mostrados podem ser apenas uma seleção.';
export function validatedProjectChange(value: unknown, request: AssistantInput): ProjectChange | undefined {
  if (!request.projectData || !value || typeof value !== 'object' || Array.isArray(value)) return;
  let candidate = value as Record<string, unknown>;
  if (candidate.action === 'create_project') candidate = { description: '', tasks: [], ...candidate };
  if (!validChange(candidate) || !['create_project', 'add_tasks', 'complete_task'].includes(candidate.action)) return;
  if (candidate.action !== 'create_project') {
    const project = request.projectData.find(project => project.id === candidate.projectId && !project.archived);
    if (!project || candidate.action === 'complete_task' && !project.tasks.some(task => task.id === candidate.taskId && task.status === 'pending')) return;
  }
  return candidate;
}
export function selectedProjects(projects: PersonalProject[], message: string): PersonalProject[] {
  const terms = new Set(words(message).filter(word => !neutral.has(word)));
  const selected = projects.filter(project => !project.archived).map(project => ({ project, score: words(project.title + ' ' + project.description).filter(word => terms.has(word)).length }))
    .sort((a, b) => b.score - a.score || b.project.updatedAt.localeCompare(a.project.updatedAt)).slice(0, 5);
  let remaining = 40;
  return selected.map(({ project }) => { const tasks = project.tasks.slice(0, remaining); remaining -= tasks.length; return { ...project, description: project.description.slice(0, 300), tasks }; });
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
    || !Array.isArray(plan.queries) || !plan.queries.length || plan.queries.length > 3 || personalQuestion(request.message) || request.knowledgeOnly) return;
  const allowed = new Set(words(request.message + ' ' + (request.searchContext?.query ?? '') + ' ' + (request.publicSearchTerms ?? '')).filter(word => !neutral.has(word)));
  const privateWords = new Set(words([...(request.personalMemory ?? []), ...(request.personalNotes ?? []), ...(request.context ?? []).map(turn => turn.content), request.privateProjectTerms ?? '', request.privateKnowledgeTerms ?? ''].join(' ')).filter(word => !neutral.has(word)));
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
