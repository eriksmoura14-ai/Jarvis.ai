import type { SearchSource } from '../shared/contracts.js';
import { searchQuery } from '../shared/search.js';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const concepts = (text: string) => normalize(text)
  .replace(/\b(?:segunda|2[aªºo]?)\s+fase\b/g, ' fase2 ')
  .replace(/olimpiada brasileira de matematica (?:das |de )?escolas publicas/g, ' obmep ')
  .replace(/\b(?:inteligencia artificial|artificial intelligence|machine learning|aprendizado de maquina|ia|ai)\b/g, ' inteligenciaartificial ')
  .replace(/\b(?:ukraine|ukrainians?|ucrania|ucranian[oa]s?)\b/g, ' ucrania ')
  .replace(/\b(?:war|guerra)\b/g, ' guerra ')
  .replace(/\b(?:technology|technologies|tecnologias?|tecnologic[oa]s?)\b/g, ' tecnologia ');
const ignored = new Set('a o as os um uma uns umas de do da dos das e em no na nos nas para por com sobre que qual quais como onde quando quanto the of and in on for what how latest recent ultimas ultimos ultima ultimo noticias noticia news headlines manchetes hoje today atual atuais recentes novidades me diga mostre quero saber favor please tem temos ha existe existem esta estao sao agora atualmente pode poderia consegue dizer informe mim pra voce jarvis oi ola bom dia boa tarde noite'.split(' '));

export function searchIntent(query: string) {
  // Use the same command grammar even when WebSearch is called directly.
  query = searchQuery({ message: query, webSearch: true }) ?? query;
  const news = /\b(?:noticias?|novidades|news|headlines|manchetes)\b/.test(normalize(query));
  // Expand whole-word acronyms: "ia" must never match Bahrain or other substrings.
  const subject = query.replace(/^\s*(?:sobre|a respeito de)\s+/i, '').replace(/\bia\b/gi, 'inteligência artificial');
  const engineQuery = news ? subject
    .replace(/\b(?:[uú]ltimas?\s+|[uú]ltimos?\s+)?(?:not[ií]cias?|news|headlines|manchetes)\b/gi, '')
    .replace(/(?:[uú]ltimas?|[uú]ltimos?)\s+/gi, '')
    .replace(/^\s*(?:sobre|de|do|da)\s+/i, '')
    .replace(/\s+/g, ' ').trim() || subject : subject;
  const keywords = engineQuery.split(/\s+/).filter(word => !ignored.has(normalize(word).replace(/[^\p{L}\p{N}]/gu, ''))).join(' ');
  const terms = [...new Set(concepts(engineQuery.replace(/\bsite:\S+/gi, '')).match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(term => !ignored.has(term));
  const anchor = engineQuery.match(/\b(?:na|no|em|do|da|de)\s+(.+)$/i)?.[1] ?? '';
  const anchors = (concepts(anchor).match(/[\p{L}\p{N}]+/gu) ?? []).filter(term => !ignored.has(term));
  const requestedDomain = engineQuery.match(/\bsite:((?:[a-z0-9-]+\.)+[a-z]{2,})/i)?.[1].toLowerCase();
  return { news, engineQuery, keywords, relevant: (source: SearchSource) => {
    if (requestedDomain) {
      try { const host = new URL(source.url).hostname.toLowerCase(); if (host !== requestedDomain && !host.endsWith('.' + requestedDomain)) return false; }
      catch { return false; }
    }
    if (!terms.length) return true;
    const words = new Set(concepts(`${source.title} ${source.snippet}`).match(/[\p{L}\p{N}]+/gu) ?? []);
    return (!anchors.length || anchors.some(term => words.has(term))) && terms.filter(term => words.has(term)).length >= Math.max(1, Math.ceil(terms.length / 2));
  } };
}
