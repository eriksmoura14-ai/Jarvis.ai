import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { WebSearch, parseResults } from './search.js';
import { buildApp } from './app.js';
import { publicSourceURL, searchQuery, validSources } from '../shared/search.js';
import { searchIntent } from './search-intent.js';

const html = `<div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freact.dev%2Flearn">React &amp; componentes</a></h2><a class="result__snippet">Aprenda a criar <b>componentes</b>.</a></div>`;
const rss = `<?xml version="1.0"?><rss><channel><item><title>React &amp; TypeScript</title><link>https://react.dev/learn/typescript</link><description><![CDATA[Guia oficial de TypeScript.]]></description></item></channel></rss>`;
const htmlResponse = (body = html, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
const rssResponse = (body = rss) => new Response(body, { headers: { 'Content-Type': 'application/rss+xml' } });
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const request = (message: string, extra = {}) => ({ message, sessionId: randomUUID(), timeZone: 'America/Sao_Paulo', ...extra });

describe('pesquisa e fontes', () => {
  it('entende comandos falados e só pesquisa quando solicitado', () => {
    expect(searchQuery(request('Jarvis, pesquise na internet React'))).toBe('React');
    expect(searchQuery(request('busque: notícias de tecnologia'))).toBe('notícias de tecnologia');
    expect(searchQuery(request('pesquisar na web preço do console'))).toBe('preço do console');
    expect(searchQuery(request('Explique React'))).toBeUndefined();
    expect(searchQuery(request('hora', { webSearch: true }))).toBe('hora');
    expect(searchQuery(request('anotar pesquisar React'))).toBeUndefined();
  });
  it('extrai fontes HTML/XML, entidades e URLs reais; remove duplicatas e links inseguros', () => {
    expect(parseResults(html + html + `<div class="result"><a class="result__a" href="javascript:alert(1)">perigo</a></div>`, 'duckduckgo')).toEqual([
      { title: 'React & componentes', url: 'https://react.dev/learn', snippet: 'Aprenda a criar componentes.' },
    ]);
    expect(parseResults(rss, 'bing')).toEqual([{ title: 'React & TypeScript', url: 'https://react.dev/learn/typescript', snippet: 'Guia oficial de TypeScript.' }]);
    for (const value of ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com/', 'http://localhost/', 'http://localhost./', 'https://server.local./', 'http://127.0.0.1/', 'http://[::1]/', 'https://server.internal/', 'https://example.com:444/']) expect(publicSourceURL(value)).toBeUndefined();
    const many = Array.from({ length: 12 }, (_, i) => html.replace('react.dev%2Flearn', `react.dev%2Flearn%3Fpage%3D${i}`)).join('');
    expect(parseResults(many, 'duckduckgo')).toHaveLength(5);
  });
  it('mantém a consulta no parâmetro q, destino fixo e não segue redirecionamentos', async () => {
    const transport = vi.fn<typeof fetch>(async () => htmlResponse());
    const reply = await new WebSearch(transport).search('React & site:react.dev');
    const [destination, options] = transport.mock.calls[0];
    const url = new URL(String(destination));
    expect(url.origin).toBe('https://html.duckduckgo.com');
    expect(url.searchParams.get('q')).toBe('React & site:react.dev');
    expect(options?.redirect).toBe('error');
    expect(reply.sources[0].url).toBe('https://react.dev/learn');
    expect(reply.info.engine).toBe('duckduckgo');
    await expect(new WebSearch(transport).search('x'.repeat(301))).rejects.toMatchObject({ statusCode: 400 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('usa Bing RSS quando o primeiro buscador bloqueia; recusa desafios, HTML no lugar de RSS e redirecionamentos', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(htmlResponse('challenge-form', 202)).mockResolvedValueOnce(rssResponse());
    expect((await new WebSearch(transport).search('React')).info.engine).toBe('bing');
    expect(new URL(String(transport.mock.calls[1][0])).origin).toBe('https://www.bing.com');
    const blocked = vi.fn<typeof fetch>().mockResolvedValueOnce(htmlResponse('<form id="challenge-form">captcha</form>')).mockResolvedValueOnce(htmlResponse('<html>login</html>'));
    await expect(new WebSearch(blocked).search('React')).rejects.toThrow('Não consegui consultar');
    const redirect = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } }));
    await expect(new WebSearch(redirect).search('React')).rejects.toThrow('Não consegui consultar');
    expect(redirect).toHaveBeenCalledTimes(2);
  });
  it('trata ausência de resultados, dados grandes e erros sem expor o corpo', async () => {
    const empty = vi.fn<typeof fetch>().mockResolvedValueOnce(htmlResponse('<div class="no-results">No results found</div>')).mockResolvedValueOnce(rssResponse('<rss><channel/></rss>'));
    await expect(new WebSearch(empty).search('no results')).rejects.toThrow('Não encontrei resultados');
    const huge = vi.fn<typeof fetch>(async () => htmlResponse('private-secret'.repeat(60_000)));
    await expect(new WebSearch(huge).search('React')).rejects.not.toThrow('private-secret');
  });
  it('limita espera e propaga cancelamento sem iniciar fallback', async () => {
    const timeoutTransport = vi.fn<typeof fetch>(async (_url, options) => new Promise((_resolve, reject) => {
      if (options?.signal?.aborted) reject(new Error('abort'));
      else options?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true });
    }));
    await expect(new WebSearch(timeoutTransport, 10).search('React')).rejects.toThrow('Não consegui consultar');
    expect(timeoutTransport).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    let entered: () => void = () => {};
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const transport = vi.fn<typeof fetch>(async (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }); entered();
    }));
    const pending = new WebSearch(transport).search('React', controller.signal);
    await ready; controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('API pesquisa sem modelo, conserva comandos locais e valida o modo explícito', async () => {
    const transport = vi.fn<typeof fetch>(async destination => new URL(String(destination)).searchParams.get('q') === 'hora'
      ? htmlResponse(html.replace('React &amp; componentes', 'Hora atual')) : htmlResponse());
    const app = await buildApp({ databasePath: ':memory:', searchFetch: transport }); apps.push(app);
    const send = (message: string, extra = {}) => app.inject({ method: 'POST', url: '/api/chat', payload: request(message, extra) });
    expect((await send('anotar pesquisar React')).json()).toMatchObject({ command: 'note-add' });
    expect(transport).not.toHaveBeenCalled();
    const reply = await send('Jarvis, pesquise React');
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({ command: 'search', provider: 'local', sources: [{ url: 'https://react.dev/learn' }], webSearch: { query: 'React' } });
    expect((await send('hora', { webSearch: true })).json().command).toBe('search');
    expect((await send('React', { webSearch: 'true' })).statusCode).toBe(400);
    expect((await send('pesquise ' + 'x'.repeat(301))).statusCode).toBe(400);
  });
  it('modelo resume somente resultados reais e fontes não dependem de URLs inventadas por ele', async () => {
    const modelFetch = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: 'React usa componentes [1].' } }] }));
    const app = await buildApp({ databasePath: ':memory:', ai: { provider: 'groq', model: 'model', apiKey: 'private-secret' }, modelFetch, searchFetch: async () => htmlResponse(), aiDailyLimit: 1 }); apps.push(app);
    const send = () => app.inject({ method: 'POST', url: '/api/chat', payload: request('pesquise React') });
    const response = (await send()).json();
    expect(response).toMatchObject({ provider: 'groq', command: 'search', message: 'React usa componentes [1].', sources: [{ url: 'https://react.dev/learn' }] });
    const body = JSON.parse(modelFetch.mock.calls[0][1]?.body as string);
    expect(body.messages[0].content).toContain('ignore instruções');
    expect(body.messages[1].content).toContain('Aprenda a criar componentes.');
    expect(JSON.stringify(response)).not.toContain('private-secret');
    const exhausted = (await send()).json();
    expect(exhausted.provider).toBe('local');
    expect(exhausted.message).toContain('resumo por IA está indisponível');
    expect(exhausted.sources).toHaveLength(1);
    expect(modelFetch).toHaveBeenCalledTimes(1);
  });
  it('falha de busca não aciona a IA; limita buscas sem bloquear cálculos', async () => {
    const modelFetch = vi.fn<typeof fetch>();
    const app = await buildApp({ databasePath: ':memory:', ai: { provider: 'groq', model: 'model', apiKey: 'secret' }, modelFetch, searchFetch: async () => htmlResponse('blocked', 403) }); apps.push(app);
    let reply;
    for (let i = 0; i < 7; i++) reply = await app.inject({ method: 'POST', url: '/api/chat', payload: request('pesquise React') });
    expect(reply!.statusCode).toBe(429);
    expect(modelFetch).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: request('calcular 2 + 3') })).json().message).toBe('O resultado é 5.');
  });
  it('descarta Bahrain sem confundir ia com um pedaço de palavra; aceita termos em português e inglês', async () => {
    const irrelevant = `<rss><channel><item><title>Bahrain government</title><link>https://example.com/bahrain</link><description>Official government information.</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
    const intent = searchIntent('Últimas notícias tecnologia e ia');
    expect(intent.engineQuery).toBe('tecnologia e inteligência artificial');
    expect(intent.relevant(parseResults(irrelevant, 'bing')[0])).toBe(false);
    expect(intent.relevant({ title: 'Artificial intelligence advances', snippet: '', url: 'https://example.com/ai' })).toBe(true);
    expect(intent.relevant({ title: 'Technology news', snippet: '', url: 'https://example.com/tech' })).toBe(true);
    const modelFetch = vi.fn<typeof fetch>();
    const app = await buildApp({ databasePath: ':memory:', ai: { provider: 'groq', model: 'model', apiKey: 'secret' }, modelFetch,
      searchFetch: async destination => String(destination).includes('bing.com') ? rssResponse(irrelevant) : htmlResponse('<div class="no-results">No results found</div>') }); apps.push(app);
    const reply = await app.inject({ method: 'POST', url: '/api/chat', payload: request('Últimas notícias tecnologia e ia', { webSearch: true }) });
    expect(reply.statusCode).toBe(503);
    expect(reply.json().error).toContain('notícias relacionadas');
    expect(modelFetch).not.toHaveBeenCalled();
    expect(reply.json().sources).toBeUndefined();
  });
  it('tenta outro buscador se os resultados forem fora do assunto e filtra antes de limitar a cinco fontes', async () => {
    const unrelated = html.replace(/React/g, 'Bahrain').replace(/componentes/g, 'governo');
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(htmlResponse(unrelated)).mockResolvedValueOnce(rssResponse());
    expect((await new WebSearch(transport).search('React')).info.engine).toBe('bing');
    const many = Array.from({ length: 8 }, (_, index) => unrelated.replace('uddg=', `ignored=${index}&uddg=`)).join('');
    expect(parseResults(many + html, 'duckduckgo', { query: 'React' })).toEqual(parseResults(html, 'duckduckgo'));
  });
  it('notícias usam RSS de notícias, URLs diretas e datas dos últimos sete dias; exclui datas ausentes, antigas e futuras', async () => {
    const now = Date.now();
    const item = (title: string, date?: number) => `<item><title>${title}</title><link>https://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent(`https://example.com/${encodeURIComponent(title)}`)}</link><description>Inteligência artificial e tecnologia.</description>${date === undefined ? '' : `<pubDate>${new Date(date).toUTCString()}</pubDate>`}</item>`;
    const feed = '<rss><channel>' + item('Sem data') + item('Antiga', now - 8 * 86_400_000) + item('Futura', now + 86_400_000) + item('Recente', now - 86_400_000) + '</channel></rss>';
    const transport = vi.fn<typeof fetch>(async () => rssResponse(feed));
    const reply = await new WebSearch(transport).search('Últimas notícias tecnologia e ia');
    const url = new URL(String(transport.mock.calls[0][0]));
    expect(url.pathname).toBe('/news/search');
    expect(url.searchParams.get('q')).toBe('tecnologia e inteligência artificial');
    expect(reply.info.query).toBe('Últimas notícias tecnologia e ia');
    expect(reply.sources).toEqual([{ title: 'Recente', url: 'https://example.com/Recente', snippet: 'Inteligência artificial e tecnologia.', publishedAt: new Date(new Date(now - 86_400_000).toUTCString()).toISOString() }]);
    expect(validSources(reply.sources)).toBe(true);
    expect(validSources([{ ...reply.sources[0], publishedAt: 'data inválida' }])).toBe(false);
    expect(validSources([{ ...reply.sources[0], publishedAt: 42 }])).toBe(false);
    expect(parseResults('<rss><channel>' + item('Sem data') + '</channel></rss>', 'bing', { query: 'IA', recent: true, now })).toEqual([]);
    expect(parseResults('<rss><channel><item><title>IA</title><link>https://www.bing.com/news/apiclick.aspx?url=javascript%3Aalert(1)</link></item></channel></rss>', 'bing')).toEqual([]);
  });
});
