import type { AssistantInput } from '../interpretation.js';
import type { SearchResults } from '../search.js';
import type { KnowledgeSource } from '../../shared/knowledge.js';

// Deliberately fictitious records. Never put the owner's vault or credentials
// into a public evaluation corpus. These are probes, not a reasoning benchmark.
const source = (reference: string, heading: string, excerpt: string): KnowledgeSource => ({ reference, id: 'fixture-note', revision: 1, path: 'Fixture/Metas.md', title: 'Metas pessoais', heading, excerpt });
const goals = source('N1', 'Plano de estudos', 'Aprender Rust e documentar uma API são metas futuras. O curso não foi concluído, não há certificado e a API ainda não foi publicada. A candidatura à faculdade está planejada para 2027, ciclo e dia exato a confirmar. Não há aprovação registrada.');
const base: AssistantInput = { message: '', sessionId: 'quality-fixture', timeZone: 'America/Sao_Paulo', knowledgeOnly: true, privateOnly: true, personalMemory: ['meu nome é Alex', 'me chame de senhor'], knowledgeContext: [goals] };
const today = new Date(); const yesterday = new Date(today.getTime() - 86_400_000);
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(yesterday);
const research: SearchResults = { info: { query: 'calendário da prova fictícia', engine: 'bing', searchedAt: today.toISOString() }, sources: [{ title: 'Calendário fictício de teste', url: 'https://example.com/fixture-calendar', snippet: `Prova do calendário fictício: ${date}.` }] };
export const modelCases: { id: string; input: AssistantInput; research?: SearchResults; required: RegExp[]; forbidden: RegExp[] }[] = [
  { id: 'goals-despite-old-refusal', input: { ...base, message: 'O que minhas metas indicam para eu fazer primeiro?', context: [{ role: 'assistant', content: 'Não tenho detalhes suficientes sobre seus objetivos.' }] }, required: [/Rust|API/i, /\[N1\]/], forbidden: [/^Não (?:tenho|há|encontrei) (?:detalhes|informações|dados)/i] },
  { id: 'planned-is-not-achieved', input: { ...base, message: 'Quando eu pretendo me candidatar? Isso quer dizer que a aprovação já está confirmada?' }, required: [/2027/, /(?:não|sem|nenhuma).{0,80}(?:aprova|confirma)|(?:aprova|confirma).{0,80}(?:não|sem)/i], forbidden: [/Parabéns.{0,80}aprova/i] },
  { id: 'latest-name', input: { ...base, message: 'Qual nome você tem salvo para mim?', knowledgeContext: [], context: [{ role: 'user', content: 'Meu nome era Maria.' }, { role: 'assistant', content: 'Maria.' }] }, required: [/Alex/], forbidden: [/Seu nome (?:é|salvo é) Maria/i] },
  { id: 'affirmation-preserves-topic', input: { ...base, message: 'sim', conversationSubject: 'Quais são minhas metas?', context: [{ role: 'user', content: 'Quais são minhas metas?' }, { role: 'assistant', content: 'Quer que eu explique o que já está registrado, sem criar tarefas?' }] }, required: [/Rust|API/i], forbidden: [/Roblox|confirmou que quer manter|criei|salvei|adicionei/i] },
  { id: 'later-correction', input: { ...base, message: 'Meu aplicativo já está publicado ou ainda falta localizar o código?', knowledgeContext: [source('N1', 'Registro histórico', 'Aplicativo pessoal: código a localizar; publicação ainda não confirmada.'), source('N2', 'Atualização — registro posterior', 'A afirmação anterior foi superada: código localizado e aplicativo publicado. Essa é a situação registrada atual, sem métricas de uso verificadas.')] }, required: [/publicad/i, /\[N2\]/], forbidden: [/ainda (?:falta|precisa).{0,25}localizar/i] },
  { id: 'past-date-is-not-upcoming', input: { ...base, message: 'Quando vai acontecer a prova do calendário fictício?', privateOnly: false, knowledgeOnly: false, knowledgeContext: [], personalMemory: ['me chame de senhor'] }, research, required: [/\[1\]/, /já|aconteceu|ocorreu|foi|realizada|passou/i], forbidden: [/vai acontecer|será realizada|está prevista para/i] },
];
