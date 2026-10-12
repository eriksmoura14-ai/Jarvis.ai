import type { ConversationTurn } from '../../shared/contracts.js';

export interface RoutingCase {
  id: string;
  message: string;
  context?: ConversationTurn[];
  fromKnowledge?: boolean;
  expected: { search: boolean; clarification?: boolean; personal?: boolean; subject?: string };
}
const dialogue = (question: string, answer: string): ConversationTurn[] => [{ role: 'user', content: question }, { role: 'assistant', content: answer }];
export const routingCases: RoutingCase[] = [
  { id: 'search-missing-subject', message: 'pode pesquisar para mim', expected: { search: false, clarification: true } },
  { id: 'search-empty-command', message: 'pesquise', expected: { search: false, clarification: true } },
  { id: 'search-politeness-only', message: 'Oi Jarvis, pode pesquisar pra mim por favor?', expected: { search: false, clarification: true } },
  { id: 'search-pronoun-without-context', message: 'pesquise sobre isso', expected: { search: false, clarification: true } },
  { id: 'event-obmep-date', message: 'quando vai acontecer a segunda fase da obmep?', expected: { search: true } },
  { id: 'event-enem-date', message: 'Qual é a data da prova do ENEM 2026?', expected: { search: true } },
  { id: 'event-obmep-accepted-offer', message: 'sim', fromKnowledge: true, context: dialogue('quando vai acontecer a segunda fase da obmep?', 'Não há data oficial registrada. Se quiser, posso ajudar a verificar fontes externas quando houver acesso à internet.'), expected: { search: true, subject: 'obmep' } },
  { id: 'event-search-accepted-request', message: 'pode pesquisar para mim', fromKnowledge: true, context: dialogue('Qual é a data da segunda fase da OBMEP?', 'Posso verificar a data nas fontes oficiais. Quer que eu pesquise?'), expected: { search: true, subject: 'obmep' } },
  { id: 'affirmation-without-context', message: 'sim', expected: { search: false, clarification: true } },
  { id: 'affirmation-with-personal-subject', message: 'sim', context: dialogue('Quais são minhas metas?', 'Quer que eu explique os prazos dessas metas?'), fromKnowledge: true, expected: { search: false, personal: true, subject: 'metas' } },
  { id: 'private-do-not-export', message: 'pode pesquisar para mim', context: dialogue('Quais são meus objetivos?', 'Quer continuar com seu planejamento?'), fromKnowledge: true, expected: { search: false, clarification: true } },
  { id: 'private-explicit-source', message: 'Pesquise minhas notas do Obsidian', expected: { search: false, personal: true } },
  { id: 'private-goals', message: 'Quais são meus futuros objetivos?', expected: { search: false, personal: true } },
  { id: 'private-name', message: 'Qual meu nome?', expected: { search: false, personal: true } },
  { id: 'private-calendar', message: 'Quando é minha consulta?', expected: { search: false, personal: true } },
  { id: 'public-price', message: 'Qual o preço do PS5 hoje?', expected: { search: true } },
  { id: 'public-news', message: 'Últimas notícias tecnologia e IA', expected: { search: true } },
  { id: 'stable-explanation', message: 'Agora me explique React', expected: { search: false } },
  { id: 'private-source-followup', message: 'no Obsidian', context: dialogue('Me explique React', 'React organiza interfaces.'), expected: { search: false, personal: true, subject: 'react' } },
  { id: 'private-deadline-followup', message: 'E qual o prazo?', context: dialogue('Quais são meus objetivos no Obsidian?', 'Há uma meta de estudar no exterior.'), fromKnowledge: true, expected: { search: false, personal: true, subject: 'objetivos' } },
  { id: 'public-pronoun-followup', message: 'pesquise sobre isso', context: dialogue('Me explique React', 'React organiza interfaces.'), expected: { search: true, subject: 'react' } },
  { id: 'no-repeat-mutation', message: 'Explique melhor', context: dialogue('anotar estudar React', 'Nota salva: estudar React'), expected: { search: false, personal: true } },
];
