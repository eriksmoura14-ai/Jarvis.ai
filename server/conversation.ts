import type { ConversationTurn } from '../shared/contracts.js';
import { knowledgeQuestion, normalizeKnowledge } from '../shared/knowledge.js';
import { personalQuestion } from './interpretation.js';

const clean = (text: string) => normalizeKnowledge(text).trim().replace(/^(?:(?:oi|ola)[, ]+)?jarvis[,.:!]?\s+/, '').replace(/[,.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
const sourceOnly = (text: string) => /^(?:(?:e|mas|nao|quero dizer|quis dizer)\s+)?(?:no|do|na|da|nas|nos) (?:meu |minha |minhas |meus )?(?:obsidian|cofre|vault|biblioteca|notas|anotacoes)$/.test(clean(text));
const webOnly = (text: string) => /^(?:(?:e|mas|nao|quero dizer|quis dizer)\s+)?(?:na web|na internet|pesquise na web|pesquise na internet)$/.test(clean(text));
const formatOnly = (text: string) => /^(?:e |agora |por favor )?(?:continue|prossiga|explique melhor|explique mais|mais detalhes|resuma|resuma isso|mais curto|mais curta|mais simples|simplifique|de um exemplo|me de um exemplo|faca uma lista|em uma frase|em poucas palavras)(?: por favor)?$/.test(clean(text));
const refersBack = (text: string) => /\b(?:isso|nisso|disso|esses? estudos|essas? notas?|esse assunto|essa ideia|esse projeto|essa tarefa|essa resposta|o mesmo|mais detalhes)\b/.test(clean(text));
const follows = (text: string) => sourceOnly(text) || webOnly(text) || formatOnly(text) || refersBack(text);
const greeting = (text: string) => /^(?:oi|ola|bom dia|boa tarde|boa noite|obrigado|obrigada|ok|certo)$/.test(clean(text));
const sourceClarification = 'Qual assunto ou nota você quer consultar no Obsidian?';

export interface ConversationResolution {
  query: string;
  subject?: string;
  knowledgeOnly: boolean;
  privateOnly: boolean;
  clarification?: string;
}
// Only active server history is used in personal mode. Never turn an old action
// into a new command, or put a private continuation into a public search query.
export function resolveConversation(context: ConversationTurn[], message: string, lastAnswerFromKnowledge = false): ConversationResolution {
  const latestAssistant = [...context].reverse().find(turn => turn.role === 'assistant');
  const answeringSource = latestAssistant?.content.startsWith(sourceClarification) && message.length <= 300
    && !/\b(?:agora|esquece|esqueca|mude|web|internet|pesquise|pesquisar|busque|buscar)\b/.test(clean(message));
  const continuation = follows(message);
  let subject: string | undefined;
  let inheritedKnowledge = false;
  let inheritedPrivate = false;
  if (continuation) {
    for (const turn of [...context].reverse()) {
      if (turn.role !== 'user') continue;
      inheritedKnowledge ||= knowledgeQuestion(turn.content) || sourceOnly(turn.content);
      inheritedPrivate ||= personalQuestion(turn.content);
      if (follows(turn.content)) continue;
      if (!greeting(turn.content)) subject = turn.content;
      break;
    }
  }
  const knowledgeOnly = knowledgeQuestion(message) || sourceOnly(message) || (continuation && (inheritedKnowledge || lastAnswerFromKnowledge)) || !!answeringSource;
  const privateOnly = knowledgeOnly || personalQuestion(message) || (continuation && inheritedPrivate) || formatOnly(message);
  let clarification: string | undefined;
  if (sourceOnly(message) && !subject) clarification = sourceClarification + ' Posso listar as notas se você disser “notas do Obsidian”.';
  if (formatOnly(message) && !subject && !context.some(turn => turn.role === 'assistant')) clarification = 'Qual assunto você quer que eu explique ou resuma?';
  if (webOnly(message) && (inheritedPrivate || lastAnswerFromKnowledge || !subject)) clarification = 'Qual tema público você quer pesquisar na web? Diga o assunto para eu não enviar suas informações pessoais ao buscador.';
  return { query: message + (subject ? '\nAssunto anterior: ' + subject : '') + (answeringSource || (continuation && lastAnswerFromKnowledge) ? '\nno meu Obsidian' : ''), subject, knowledgeOnly, privateOnly, clarification };
}
