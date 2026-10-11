import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { readSpeechConfig, SpeechProvider } from './speech';

// Credential values are fixtures only, never real accounts or hosting keys.
const config = { apiKey: 'fixture-not-an-elevenlabs-key', voiceId: 'fixtureVoice123' };
const free = { tier: 'free', character_count: 20, character_limit: 1000 };
const clip = () => new Response(new Uint8Array([73, 68, 51, 1]), { headers: { 'Content-Type': 'audio/mpeg' } });
const libraryVoice = { voice_id: 'JarvisBrazilFixture', name: 'JARVIS brasileiro de teste', gender: 'male', language: 'pt', locale: 'pt-BR', free_users_allowed: true, rate: 1, fiat_rate: null };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function transport(account: unknown = free) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(account)).mockResolvedValueOnce(clip());
}
describe('voz ElevenLabs restrita ao plano gratuito', () => {
  it('mantém navegador como padrão e valida requisitos sem expor chaves', () => {
    expect(readSpeechConfig({})).toBeUndefined();
    const env = { TTS_PROVIDER: 'elevenlabs', JARVIS_PASSWORD: 'fixture-password-123', ELEVENLABS_API_KEY: config.apiKey, ELEVENLABS_VOICE_ID: config.voiceId };
    expect(readSpeechConfig(env)).toEqual(config);
    expect(() => readSpeechConfig({ ...env, TTS_PROVIDER: 'invalid' })).toThrow('TTS_PROVIDER');
    expect(() => readSpeechConfig({ ...env, JARVIS_PASSWORD: '' })).toThrow('JARVIS_PASSWORD');
    expect(() => readSpeechConfig({ ...env, ELEVENLABS_API_KEY: '' })).toThrow('ELEVENLABS_API_KEY');
    expect(() => readSpeechConfig({ ...env, ELEVENLABS_VOICE_ID: 'https://other/secret' })).toThrow('ELEVENLABS_VOICE_ID');
  });
  it('verifica o plano antes de enviar texto e usa apenas o endpoint fixo', async () => {
    const fetcher = transport();
    expect(await new SpeechProvider(config, fetcher).synthesize('Olá, sou o Jarvis.')).toEqual(Buffer.from([73, 68, 51, 1]));
    expect(fetcher.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/user/subscription');
    const [url, request] = fetcher.mock.calls[1];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/fixtureVoice123?output_format=mp3_44100_128');
    expect(request).toMatchObject({ redirect: 'error', method: 'POST', headers: { 'xi-api-key': config.apiKey } });
    expect(JSON.parse(request!.body as string)).toMatchObject({ text: 'Olá, sou o Jarvis.', model_id: 'eleven_multilingual_v2' });
  });
  it.each(['british', 'jarvis-br'] as const)('aplica estilo estável %s e Voice ID escolhido sem permitir URL ou trocar o modelo', async profile => {
    const fetcher = transport();
    await new SpeechProvider(config, fetcher).synthesize('Good morning, sir.', undefined, { voiceId: 'BritishFixture', profile });
    expect(fetcher.mock.calls[1][0]).toBe('https://api.elevenlabs.io/v1/text-to-speech/BritishFixture?output_format=mp3_44100_128');
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ text: 'Good morning, sir.', model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.7, similarity_boost: 0.75, style: 0, use_speaker_boost: true } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(new SpeechProvider(config, fetcher).synthesize('Olá.', undefined, { voiceId: 'https://other.test/' })).rejects.toMatchObject({ statusCode: 400 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('busca JARVIS brasileiro no host fixo e exclui vozes pagas, desconhecidas ou incompatíveis', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ voices: [
      { ...libraryVoice, preview_url: 'https://other.test/private', public_owner_id: config.apiKey },
      { ...libraryVoice, voice_id: 'Paid', free_users_allowed: false }, { ...libraryVoice, voice_id: 'Unknown', free_users_allowed: undefined },
      { ...libraryVoice, voice_id: 'Female', gender: 'female' }, { ...libraryVoice, voice_id: 'English', language: 'en' },
      { ...libraryVoice, voice_id: 'Portugal', locale: 'pt-PT' }, { ...libraryVoice, voice_id: '../secret' },
      { ...libraryVoice, voice_id: 'CustomRate', rate: 2 }, { ...libraryVoice, voice_id: 'FiatRate', fiat_rate: 0.5 },
      { ...libraryVoice, voice_id: 'Unrelated', name: 'Outra voz' }, libraryVoice,
    ] }));
    const result = await new SpeechProvider(config, fetcher).brazilianVoices();
    expect(result).toEqual({ voices: [{ id: libraryVoice.voice_id, name: libraryVoice.name }], matchedJarvis: true });
    const url = new URL(fetcher.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://api.elevenlabs.io/v1/shared-voices');
    expect(Object.fromEntries(url.searchParams)).toEqual({ language: 'pt', locale: 'pt-BR', gender: 'male', page_size: '20', include_custom_rates: 'false', search: 'jarvis' });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { 'xi-api-key': config.apiKey } });
    expect(JSON.stringify(result)).not.toContain(config.apiKey); expect(JSON.stringify(result)).not.toContain('preview_url');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('apresenta alternativas brasileiras com nome próprio sem afirmar que sejam JARVIS', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ voices: [{ ...libraryVoice, free_users_allowed: false }] }))
      .mockResolvedValueOnce(Response.json({ voices: Array.from({ length: 12 }, (_, i) => ({ ...libraryVoice, voice_id: `Fixture${i}`, name: `Brasileiro ${i}` })) }));
    const result = await new SpeechProvider(config, fetcher).brazilianVoices();
    expect(result.matchedJarvis).toBe(false); expect(result.voices).toHaveLength(6);
    expect(new URL(fetcher.mock.calls[1][0] as string).searchParams.has('search')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('não inventa uma voz quando a biblioteca não contém uma alternativa gratuita', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ voices: [{ ...libraryVoice, free_users_allowed: false }] }));
    expect(await new SpeechProvider(config, fetcher).brazilianVoices()).toEqual({ voices: [], matchedJarvis: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('consulta somente saldo e renovação da conta, sem gerar áudio ou expor campos externos', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ...free, next_character_count_reset_unix: 1793491200, email: 'private@example.test', api_key: config.apiKey }));
    expect(await new SpeechProvider(config, fetcher).quota()).toEqual({ used: 20, limit: 1000, remaining: 980, nextResetAt: '2026-11-01T00:00:00.000Z' });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/user/subscription');
  });
  it('mostra saldo esgotado sem tentar síntese e omite renovação inválida', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ...free, character_count: 1001, next_character_count_reset_unix: 'tomorrow' }));
    expect(await new SpeechProvider(config, fetcher).quota()).toEqual({ used: 1001, limit: 1000, remaining: 0 }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...free, tier: 'paid' }, { ...free, character_count: -1 }, { ...free, character_limit: '1000' }])('não apresenta cota inválida: %j', async data => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(data));
    await expect(new SpeechProvider(config, fetcher).quota()).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancela e limita a consulta de saldo sem gerar áudio', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
    }));
    const controller = new AbortController(); controller.abort();
    await expect(new SpeechProvider(config, fetcher).quota(controller.signal)).rejects.toMatchObject({ statusCode: 499 }); expect(fetcher).not.toHaveBeenCalled();
    await expect(new SpeechProvider(config, fetcher, 10).quota()).rejects.toThrow('demorou'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { voices: null }])('rejeita catálogo malformado %j', async data => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(data));
    await expect(new SpeechProvider(config, fetcher).brazilianVoices()).rejects.toThrow('dados inválidos');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('explica permissão Voices Read sem exibir detalhes externos ou gerar áudio', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ detail: { status: 'missing_permissions', message: config.apiKey } }, { status: 403 }));
    await expect(new SpeechProvider(config, fetcher).brazilianVoices()).rejects.toThrow('Voices → Read');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancela catálogo antes da consulta e limita tempo de resposta', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
    }));
    const controller = new AbortController(); controller.abort();
    await expect(new SpeechProvider(config, fetcher).brazilianVoices(controller.signal)).rejects.toMatchObject({ statusCode: 499 });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(new SpeechProvider(config, fetcher, 10).brazilianVoices()).rejects.toThrow('demorou');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ ...free, tier: 'starter' }, { ...free, tier: 'unknown' }, null, { tier: 'free' }, { ...free, character_count: -1 }, { ...free, character_count: 999 }])('não gera áudio com plano/cota inválidos: %j', async account => {
    const fetcher = transport(account);
    await expect(new SpeechProvider(config, fetcher).synthesize('Texto para leitura.')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('não envia textos vazios ou acima do limite ao provedor', async () => {
    const fetcher = transport(); const provider = new SpeechProvider(config, fetcher);
    await expect(provider.synthesize(' ')).rejects.toMatchObject({ statusCode: 400 });
    await expect(provider.synthesize('x'.repeat(1201))).rejects.toMatchObject({ statusCode: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])('sanitiza falha HTTP %i sem divulgar corpo externo', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('external-secret-and-stack', { status }));
    await expect(new SpeechProvider(config, fetcher).synthesize('Olá.')).rejects.not.toThrow('external-secret');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['detected_unusual_activity', 'atividade incomum'], ['paid_plan_required', 'plano pago'],
    ['payment_required', 'plano pago'], ['free_users_not_allowed', 'plano pago'],
    ['quota_exceeded', 'limite de créditos'], ['invalid_api_key', 'ELEVENLABS_API_KEY'],
    ['voice_not_found', 'ELEVENLABS_VOICE_ID'], ['missing_permissions', 'User → Read'],
  ])('traduz código %s sem repetir mensagens externas', async (code, expected) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail: { status: code, message: 'external-secret-and-stack' } }, { status: 403 }));
    const provider = new SpeechProvider(config, fetcher);
    const error = await provider.synthesize('Olá.').catch(error => error as Error);
    expect(error.message).toContain(expected); expect(error.message).not.toContain('external-secret');
  });
  it('identifica a permissão da geração quando a consulta da conta passou', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(free))
      .mockResolvedValueOnce(Response.json({ detail: { status: 'missing_permissions', message: config.apiKey } }, { status: 403 }));
    await expect(new SpeechProvider(config, fetcher).synthesize('Olá.')).rejects.toThrow('Text to Speech → Access');
  });
  it('mensagens e códigos desconhecidos continuam sanitizados mesmo em JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail: { status: config.apiKey, message: config.apiKey } }, { status: 403 }));
    const error = await new SpeechProvider(config, fetcher).synthesize('Olá.').catch(error => error as Error);
    expect(error.message).toContain('User → Read'); expect(error.message).not.toContain(config.apiKey);
  });
  it('rejeita áudio vazio, formatos errados e respostas excessivas', async () => {
    for (const response of [Response.json({ secret: 'fixture-secret' }), new Response('', { headers: { 'Content-Type': 'audio/mpeg' } }), new Response(new Uint8Array(4_000_001), { headers: { 'Content-Type': 'audio/mpeg' } })]) {
      const fetcher = transport(); fetcher.mockResolvedValueOnce(response);
      // Replace the standard clip response while retaining the plan check first.
      fetcher.mockReset().mockResolvedValueOnce(Response.json(free)).mockResolvedValueOnce(response);
      await expect(new SpeechProvider(config, fetcher).synthesize('Olá.')).rejects.toThrow();
    }
  });
  it('cancela a geração e libera concorrência depois de timeout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('external-secret')), { once: true });
    }));
    const provider = new SpeechProvider(config, fetcher, 15);
    const first = provider.synthesize('Primeira resposta.');
    await expect(provider.synthesize('Segunda resposta.')).rejects.toMatchObject({ statusCode: 429 });
    await expect(first).rejects.toThrow('demorou');
    fetcher.mockResolvedValueOnce(Response.json(free)).mockResolvedValueOnce(clip());
    await expect(provider.synthesize('Após o timeout.')).resolves.toBeInstanceOf(Buffer);
  });
  it('um cancelamento anterior não chega ao serviço', async () => {
    const controller = new AbortController(); controller.abort(); const fetcher = transport();
    await expect(new SpeechProvider(config, fetcher).synthesize('Olá.', controller.signal)).rejects.toMatchObject({ statusCode: 499 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('protege a rota com sessão/origem, valida o corpo e entrega MP3 sem cache', async () => {
    const fetcher = transport(); const app = await buildApp({ databasePath: ':memory:', personal: { password: 'fixture-personal-password', secure: false }, speech: config, speechFetch: fetcher }); apps.push(app);
    const headers = { 'x-jarvis-client': '1' };
    expect((await app.inject({ method: 'POST', url: '/api/speech', headers, payload: { text: 'Olá.' } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers, payload: { password: 'fixture-personal-password' } });
    const cookie = login.cookies[0]; const authorized = { ...headers, cookie: `${cookie.name}=${cookie.value}` };
    expect((await app.inject({ method: 'POST', url: '/api/speech', headers: { cookie: authorized.cookie }, payload: { text: 'Olá.' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/speech', headers: { ...authorized, origin: 'https://other.test' }, payload: { text: 'Olá.' } })).statusCode).toBe(403);
    for (const payload of [{ text: 'x'.repeat(1201) }, { text: ' ' }, { text: 'Olá.', voiceId: '../other' },
      { text: 'Olá.', voiceId: '' }, { text: 'Olá.', profile: 'clone' }, { text: 'Olá.', apiKey: 'fixture' },
      { text: 'Olá.', model_id: 'other' }]) expect((await app.inject({ method: 'POST', url: '/api/speech', headers: authorized, payload })).statusCode).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'POST', url: '/api/speech', headers: authorized, payload: { text: 'Olá.' } });
    expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toBe('audio/mpeg'); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.rawPayload).toEqual(Buffer.from([73, 68, 51, 1]));
    const health = (await app.inject('/api/health')).json();
    expect(health.speech).toEqual({ configured: true, provider: 'elevenlabs' });
    expect(JSON.stringify(health)).not.toContain(config.apiKey); expect(JSON.stringify(health)).not.toContain(config.voiceId);
  });
  it('aceita escolha de voz apenas na sessão pessoal e mantém verificação Free', async () => {
    const fetcher = transport({ ...free, tier: 'starter' });
    const app = await buildApp({ databasePath: ':memory:', personal: { password: 'fixture-personal-password', secure: false }, speech: config, speechFetch: fetcher }); apps.push(app);
    const payload = { text: 'Good morning, sir.', profile: 'british', voiceId: 'BritishFixture' };
    expect((await app.inject({ method: 'POST', url: '/api/speech', headers: { 'x-jarvis-client': '1' }, payload })).statusCode).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password: 'fixture-personal-password' } });
    const response = await app.inject({ method: 'POST', url: '/api/speech', headers: { 'x-jarvis-client': '1', cookie: login.cookies[0].name + '=' + login.cookies[0].value }, payload });
    expect(response.statusCode).toBe(503); expect(response.json().error).toContain('plano Free');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('não permite habilitar a rota por IA sem login e explica configuração ausente', async () => {
    await expect(buildApp({ databasePath: ':memory:', speech: config })).rejects.toThrow('senha');
    const app = await buildApp({ databasePath: ':memory:' }); apps.push(app);
    expect((await app.inject({ method: 'POST', url: '/api/speech', payload: { text: 'Olá.' } })).json().error).toContain('não está configurada');
  });
  it('protege o catálogo por login e origem, recusa filtros externos e limita consultas', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ voices: [libraryVoice] }));
    const app = await buildApp({ databasePath: ':memory:', personal: { password: 'fixture-personal-password', secure: false }, speech: config, speechFetch: fetcher }); apps.push(app);
    expect((await app.inject('/api/speech/voices')).statusCode).toBe(401); expect(fetcher).not.toHaveBeenCalled();
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password: 'fixture-personal-password' } });
    const headers = { cookie: login.cookies[0].name + '=' + login.cookies[0].value };
    expect((await app.inject({ url: '/api/speech/voices', headers: { ...headers, origin: 'https://other.test' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/speech/voices?url=https://other.test', headers })).statusCode).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const result = await app.inject({ url: '/api/speech/voices', headers });
    expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json()).toEqual({ voices: [{ id: libraryVoice.voice_id, name: libraryVoice.name }], matchedJarvis: true });
    await app.inject({ url: '/api/speech/voices', headers }); await app.inject({ url: '/api/speech/voices', headers });
    expect((await app.inject({ url: '/api/speech/voices', headers })).statusCode).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('o saldo exige login e não expõe chaves ou dados do titular da conta', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ...free, key: config.apiKey, email: 'private@example.test' }));
    const app = await buildApp({ databasePath: ':memory:', personal: { password: 'fixture-personal-password', secure: false }, speech: config, speechFetch: fetcher }); apps.push(app);
    expect((await app.inject('/api/speech/quota')).statusCode).toBe(401); expect(fetcher).not.toHaveBeenCalled();
    const login = await app.inject({ method: 'POST', url: '/api/personal/login', headers: { 'x-jarvis-client': '1' }, payload: { password: 'fixture-personal-password' } });
    const headers = { cookie: login.cookies[0].name + '=' + login.cookies[0].value };
    expect((await app.inject({ url: '/api/speech/quota?key=other', headers })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/speech/quota', headers: { ...headers, origin: 'https://other.test' } })).statusCode).toBe(403);
    const result = await app.inject({ url: '/api/speech/quota', headers });
    expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json()).toEqual({ used: 20, limit: 1000, remaining: 980 });
    expect(result.body).not.toContain(config.apiKey); expect(result.body).not.toContain('private@example.test');
  });
});
