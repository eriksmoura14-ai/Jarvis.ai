import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { readSpeechConfig, SpeechProvider } from './speech';

// Credential values are fixtures only, never real accounts or hosting keys.
const config = { apiKey: 'fixture-not-an-elevenlabs-key', voiceId: 'fixtureVoice123' };
const free = { tier: 'free', character_count: 20, character_limit: 1000 };
const clip = () => new Response(new Uint8Array([73, 68, 51, 1]), { headers: { 'Content-Type': 'audio/mpeg' } });
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
    for (const payload of [{ text: 'x'.repeat(1201) }, { text: ' ' }, { text: 'Olá.', voiceId: 'other' }]) expect((await app.inject({ method: 'POST', url: '/api/speech', headers: authorized, payload })).statusCode).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'POST', url: '/api/speech', headers: authorized, payload: { text: 'Olá.' } });
    expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toBe('audio/mpeg'); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.rawPayload).toEqual(Buffer.from([73, 68, 51, 1]));
    const health = (await app.inject('/api/health')).json();
    expect(health.speech).toEqual({ configured: true, provider: 'elevenlabs' });
    expect(JSON.stringify(health)).not.toContain(config.apiKey); expect(JSON.stringify(health)).not.toContain(config.voiceId);
  });
  it('não permite habilitar a rota por IA sem login e explica configuração ausente', async () => {
    await expect(buildApp({ databasePath: ':memory:', speech: config })).rejects.toThrow('senha');
    const app = await buildApp({ databasePath: ':memory:' }); apps.push(app);
    expect((await app.inject({ method: 'POST', url: '/api/speech', payload: { text: 'Olá.' } })).json().error).toContain('não está configurada');
  });
});
