import type { ConversationTurn } from '../shared/contracts.js';
import { knowledgeQuestion, normalizeKnowledge } from '../shared/knowledge.js';
import { personalQuestion } from './interpretation.js';
import { automaticSearchQuery, publicCalendarQuery, searchQuery, vagueSearchSubject } from '../shared/search.js';
import { personalActionQuestion } from '../shared/dialogue.js';

const clean = (text: string) => normalizeKnowledge(text).trim().replace(/^(?:(?:oi|ola)[, ]+)?jarvis[,.:!]?\s+/, '').replace(/[,.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
const sourceOnly = (text: string) => /^(?:(?:e|mas|nao|quero dizer|quis dizer)\s+)?(?:no|do|na|da|nas|nos) (?:meu |minha |minhas |meus )?(?:obsidian|cofre|vault|biblioteca|notas|anotacoes)$/.test(clean(text));
const webOnly = (text: string) => /^(?:(?:e|mas|nao|quero dizer|quis dizer)\s+)?(?:na web|na internet|pesquise na web|pesquise na internet)$/.test(clean(text));
const formatOnly = (text: string) => /^(?:e |agora |por favor )?(?:continue|prossiga|explique melhor|explique mais|mais detalhes|resuma|resuma isso|mais curto|mais curta|mais simples|simplifique|de um exemplo|me de um exemplo|faca uma lista|em uma frase|em poucas palavras)(?: por favor)?$/.test(clean(text));
const detailOnly = (text: string) => /^(?:(?:e|entao|agora|mas) )?(?:qual (?:e )?(?:o )?(?:proximo passo|prazo|objetivo|estado atual)|quais (?:sao )?(?:os )?proximos passos|por onde (?:eu )?(?:comeco|comecar)|como (?:eu )?(?:comeco|comecar)|o que (?:eu )?(?:faco|fazer) primeiro|em que (?:etapa|fase) (?:esta|estamos|estou)|quanto tempo (?:falta|tenho))(?: por favor)?$/.test(clean(text));
const refersBack = (text: string) => /\b(?:isso|nisso|disso|esses? estudos|essas? notas?|esse assunto|essa ideia|esse projeto|essa tarefa|essa resposta|o mesmo|mais detalhes)\b/.test(clean(text));
const follows = (text: string) => sourceOnly(text) || webOnly(text) || formatOnly(text) || detailOnly(text) || refersBack(text);
const greeting = (text: string) => /^(?:oi|ola|bom dia|boa tarde|boa noite|obrigado|obrigada|ok|certo)$/.test(clean(text));
const sourceClarification = 'Qual assunto ou nota você quer consultar no Obsidian?';
const affirmative = (text: string) => /^(?:sim|claro|pode|pode sim|sim pode|ok|certo)(?: por favor)?$/.test(clean(text));
const researchOffer = (text: string) => /\b(?:posso|podemos|quer|deseja)\b[\s\S]{0,180}\b(?:pesquis\w*|consult\w*|verific\w*|buscar)\b/.test(clean(text));

export interface ConversationResolution {
  query: string;
  subject?: string;
  knowledgeOnly: boolean;
  privateOnly: boolean;
  clarification?: string;
  publicQuery?: string;
}
// Only active server history is used in personal mode. Never turn an old action
// into a new command, or put a private continuation into a public search query.
export function resolveConversation(context: ConversationTurn[], message: string, lastAnswerFromKnowledge = false): ConversationResolution {
  const latestAssistant = [...context].reverse().find(turn => turn.role === 'assistant');
  const explicitSearch = searchQuery({ message });
  const vagueSearch = explicitSearch !== undefined && vagueSearchSubject(explicitSearch);
  const acceptance = affirmative(message);
  const answeringSource = latestAssistant?.content.startsWith(sourceClarification) && message.length <= 300
    && !/\b(?:agora|esquece|esqueca|mude|web|internet|pesquise|pesquisar|busque|buscar)\b/.test(clean(message));
  const continuation = follows(message) || vagueSearch || acceptance;
  let subject: string | undefined;
  let inheritedKnowledge = false;
  let inheritedPrivate = false;
  if (continuation) {
    for (const turn of [...context].reverse()) {
      if (turn.role !== 'user') continue;
      inheritedKnowledge ||= knowledgeQuestion(turn.content) || sourceOnly(turn.content);
      inheritedPrivate ||= personalQuestion(turn.content);
      if (follows(turn.content) || affirmative(turn.content) || (searchQuery({ message: turn.content }) !== undefined && vagueSearchSubject(searchQuery({ message: turn.content })!))) continue;
      if (!greeting(turn.content)) subject = turn.content;
      break;
    }
  }
  let publicQuery = publicCalendarQuery(message);
  if (!publicQuery && (vagueSearch || (acceptance && latestAssistant && researchOffer(latestAssistant.content))) && subject) {
    publicQuery = publicCalendarQuery(subject) ?? (!personalQuestion(subject) && !inheritedKnowledge && !lastAnswerFromKnowledge
      ? automaticSearchQuery(subject) || subject : undefined);
  }
  const knowledgeOnly = !publicQuery && (knowledgeQuestion(message) || sourceOnly(message) || (continuation && (inheritedKnowledge || lastAnswerFromKnowledge)) || !!answeringSource);
  const privateOnly = !publicQuery && (knowledgeOnly || personalQuestion(message) || (continuation && inheritedPrivate) || formatOnly(message));
  let clarification: string | undefined;
  if (sourceOnly(message) && !subject) clarification = sourceClarification + ' Posso listar as notas se você disser “notas do Obsidian”.';
  if (formatOnly(message) && !subject && !context.some(turn => turn.role === 'assistant')) clarification = 'Qual assunto você quer que eu explique ou resuma?';
  if (detailOnly(message) && !subject) clarification = 'De qual objetivo, projeto ou assunto você está falando? Assim consigo indicar o próximo passo ou conferir o prazo certo.';
  if (webOnly(message) && (inheritedPrivate || lastAnswerFromKnowledge || !subject)) clarification = 'Qual tema público você quer pesquisar na web? Diga o assunto para eu não enviar suas informações pessoais ao buscador.';
  if (vagueSearch && !publicQuery) clarification = 'Sobre qual assunto você quer que eu pesquise?';
  if (subject && personalActionQuestion(subject) && refersBack(message) && !personalQuestion(message)
    && /\b(?:hoje|noticias|novidades)\b|o que mudou/.test(clean(message))) clarification = 'Qual tema público você quer pesquisar? A ação anterior era pessoal; preciso de um assunto para continuar.';
  if (acceptance && !subject) clarification = 'O que você quer que eu faça? Preciso do assunto para continuar.';
  return { query: acceptance && subject ? subject : message + (subject ? '\nAssunto anterior: ' + subject : '') + (answeringSource || (continuation && lastAnswerFromKnowledge) ? '\nno meu Obsidian' : ''), subject, knowledgeOnly, privateOnly, clarification, publicQuery };
}
