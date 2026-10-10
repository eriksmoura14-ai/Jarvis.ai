import type { SearchSource } from '../shared/contracts.js';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const concepts = (text: string) => normalize(text)
  .replace(/\b(?:inteligencia artificial|artificial intelligence|machine learning|aprendizado de maquina|ia|ai)\b/g, ' inteligenciaartificial ')
  .replace(/\b(?:technology|technologies|tecnologias?|tecnologic[oa]s?)\b/g, ' tecnologia ');
const ignored = new Set('a o as os um uma uns umas de do da dos das e em no na nos nas para por com sobre que qual quais como onde quando the of and in on for what how latest recent ultimas ultimos ultima ultimo noticias noticia news headlines manchetes hoje today atual atuais recentes novidades me diga mostre quero saber favor please'.split(' '));

export function searchIntent(query: string) {
  const news = /\b(?:noticias?|news|headlines|manchetes)\b/.test(normalize(query));
  // Expand whole-word acronyms: "ia" must never match Bahrain or other substrings.
  const engineQuery = news ? query
    .replace(/\b(?:[uú]ltimas?\s+|[uú]ltimos?\s+)?(?:not[ií]cias?|news|headlines|manchetes)\b/gi, '')
    .replace(/(?:[uú]ltimas?|[uú]ltimos?)\s+/gi, '')
    .replace(/^\s*(?:sobre|de|do|da)\s+/i, '')
    .replace(/\bia\b/gi, 'inteligência artificial')
    .replace(/\s+/g, ' ').trim() || query : query;
  const terms = [...new Set(concepts(query.replace(/\bsite:\S+/gi, '')).match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(term => !ignored.has(term));
  return { news, engineQuery, relevant: (source: SearchSource) => {
    if (!terms.length) return true;
    const words = new Set(concepts(`${source.title} ${source.snippet}`).match(/[\p{L}\p{N}]+/gu) ?? []);
    return terms.filter(term => words.has(term)).length >= Math.max(1, Math.ceil(terms.length / 2));
  } };
}
