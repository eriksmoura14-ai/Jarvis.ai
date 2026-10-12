import { continuous, expectStoppedContinuous } from './ui';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { prepare, completeRecognition } from './voice-cases';

async function cloud(page: Page, fakePlayback = true) {
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', provider: 'local', version: '0.1.0', speech: { configured: true, provider: 'elevenlabs' } } }));
  if (fakePlayback) await page.addInitScript(() => {
    const state = { plays: 0, pauses: 0, blocked: false, player: null as FakeAudio | null };
    class FakeAudio {
      onplaying: (() => void) | null = null; onended: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(public src: string) { state.player = this; }
      play() { state.plays++; if (state.blocked) return Promise.reject(new DOMException('Gesture required', 'NotAllowedError')); this.onplaying?.(); return Promise.resolve(); }
      pause() { state.pauses++; }
      removeAttribute() { this.src = ''; }
      load() {}
    }
    Object.defineProperty(window, 'Audio', { configurable: true, value: FakeAudio });
    (window as unknown as { speechTest: typeof state }).speechTest = state;
  });
  await prepare(page);
}
const mp3 = readFileSync(new URL('./fixtures/tone.mp3', import.meta.url));
async function response(page: Page) {
  await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
  await expect(page.getByRole('status')).toContainText('Ouvindo você');
  await completeRecognition(page, 'calcular dois mais cinco');
  await expect(page.locator('.jd-message-log .message-assistant').last()).toContainText('O resultado é 7.');
}
async function endAudio(page: Page) {
  await page.evaluate(() => (window as unknown as { speechTest: { player: { onended: () => void } } }).speechTest.player.onended());
}

test('voz por IA usa a API protegida e reprodução MP3, sem síntese nativa', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech', async route => {
    calls++; expect(route.request().headers()['x-jarvis-client']).toBe('1');
    expect(route.request().postDataJSON()).toEqual({ text: 'O resultado é 7.', profile: 'jarvis-br' });
    await route.fulfill({ contentType: 'audio/mpeg', body: mp3 });
  });
  await cloud(page); await response(page);
  await expect(page.getByRole('status')).toContainText('Respondendo');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
  await endAudio(page);
  await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvir resposta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Respondendo'); expect(calls).toBe(1);
});

test('Chromium decodifica e conclui um MP3 real pelo caminho de áudio por IA', async ({ page }) => {
  await page.addInitScript(() => {
    const read = AnalyserNode.prototype.getFloatTimeDomainData;
    const state = { peak: 0 }; (window as unknown as { meterTest: typeof state }).meterTest = state;
    AnalyserNode.prototype.getFloatTimeDomainData = function(samples) {
      read.call(this, samples);
      state.peak = Math.max(state.peak, ...samples.map(Math.abs));
    };
  });
  await page.route('**/api/speech', route => route.fulfill({ contentType: 'audio/mpeg', body: mp3 }));
  await cloud(page, false); await response(page);
  await expect(page.getByRole('status')).toContainText('Respondendo');
  await expect.poll(() => page.evaluate(() => (window as unknown as { meterTest: { peak: number } }).meterTest.peak)).toBeGreaterThan(.001);
  await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('cota gratuita esgotada tenta a voz nativa e preserva o texto', async ({ page }) => {
  await page.route('**/api/speech', route => route.fulfill({ status: 429, json: { error: 'A cota gratuita de voz foi atingida.' } }));
  await cloud(page); await response(page);
  await expect(page.getByRole('status')).toContainText('Respondendo');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual(['O resultado é 7.']);
  await page.evaluate(() => (window as unknown as { voiceTest: { utterance: { onend: () => void } } }).voiceTest.utterance.onend());
  await expect(page.locator('.jd-feedback')).toContainText('Usando a voz do aparelho');
});

test('interromper cancela geração pendente e ignora áudio atrasado', async ({ page }) => {
  let release = () => {}; const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/speech', async route => { await ready; await route.fulfill({ contentType: 'audio/mpeg', body: mp3 }).catch(() => {}); });
  await cloud(page);
  const requested = page.waitForRequest('**/api/speech'); await response(page); const original = await requested;
  const canceled = page.waitForEvent('requestfailed', request => request === original);
  await page.getByRole('button', { name: 'Interromper resposta' }).click(); await canceled; release();
  await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { speechTest: { plays: number } }).speechTest.plays)).toBe(0);
  await expect(page.locator('.jd-message-log .message-assistant').last()).toContainText('O resultado é 7.');
});

test('bloqueio de reprodução permite toque para ouvir o mesmo áudio sem consumir novamente', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech', route => { calls++; return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloud(page);
  await page.evaluate(() => { (window as unknown as { speechTest: { blocked: boolean } }).speechTest.blocked = true; });
  await response(page); await expect(page.getByRole('alert')).toContainText('O navegador bloqueou o áudio automático');
  await page.evaluate(() => { (window as unknown as { speechTest: { blocked: boolean } }).speechTest.blocked = false; });
  await page.getByRole('button', { name: 'Ouvir resposta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Respondendo'); expect(calls).toBe(1);
});

test('conversa contínua espera o áudio e interromper pausa a reprodução', async ({ page }) => {
  await page.route('**/api/speech', route => route.fulfill({ contentType: 'audio/mpeg', body: mp3 }));
  await cloud(page); await continuous(page); await response(page);
  await expect(page.getByRole('status')).toContainText('Respondendo');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { starts: number } }).voiceTest.starts)).toBe(1);
  await endAudio(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { voiceTest: { starts: number } }).voiceTest.starts)).toBe(2);
  await completeRecognition(page, 'calcular dois mais cinco'); await expect(page.getByRole('status')).toContainText('Respondendo');
  await page.getByRole('button', { name: 'Interromper resposta' }).click();
  await expectStoppedContinuous(page);
  expect(await page.evaluate(() => (window as unknown as { speechTest: { pauses: number } }).speechTest.pauses)).toBeGreaterThan(0);
});

test('preferências oferecem teste e escolha nativa persistente; fechar para o teste', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech', route => { calls++; return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloud(page); await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tipo de voz', exact: true })).toHaveValue('auto');
  await page.getByRole('button', { name: 'Testar voz', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Parar teste de voz' })).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tipo de voz', exact: true }).selectOption('browser');
  await page.getByRole('button', { name: 'Testar voz', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken.length)).toBe(1);
  await page.getByRole('button', { name: 'Fechar janela' }).click(); await page.reload();
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tipo de voz', exact: true })).toHaveValue('browser'); expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('teste ElevenLabs força voz natural mesmo quando o aparelho estava selecionado', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech', route => { calls++; return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloud(page); await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tipo de voz', exact: true }).selectOption('browser');
  await page.getByRole('button', { name: 'Testar ElevenLabs', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tipo de voz', exact: true })).toHaveValue('elevenlabs');
  await expect(page.getByRole('dialog')).toContainText('Voz reproduzida: ElevenLabs.');
  expect(calls).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Fechar janela' }).click(); await page.reload();
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tipo de voz', exact: true })).toHaveValue('elevenlabs');
});

test('falha no teste ElevenLabs mostra erro e não volta a falar pela voz do Google', async ({ page }) => {
  await page.route('**/api/speech', route => route.fulfill({ status: 503, json: { error: 'A chave ElevenLabs precisa de User → Read para verificar o plano e a cota.' } }));
  await cloud(page); await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('button', { name: 'Testar ElevenLabs', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('User → Read');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { speechTest: { plays: number } }).speechTest.plays)).toBe(0);
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await page.getByRole('button', { name: 'Falar com JARVIS', exact: true }).click();
  await completeRecognition(page, 'calcular dois mais cinco');
  await expect(page.getByRole('alert')).toContainText('User → Read');
  await expect(page.locator('.jd-message-log .message-assistant').last()).toContainText('O resultado é 7.');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
});

test('modo ElevenLabs preservado informa quando servidor não tem voz configurada', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.speech-engine.v1', 'elevenlabs'));
  await prepare(page);
  await response(page);
  await expect(page.getByRole('alert')).toContainText('não está configurado');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
});

test('mensagem digitada no chat é lida automaticamente e a opção de desligar persiste', async ({ page }) => {
  let calls = 0;
  await page.addInitScript(() => {
    localStorage.setItem('jarvis.view.v1', 'chat');
    localStorage.setItem('jarvis.voice.v1', 'false'); // Old implicit default must not keep the chat silent.
  });
  await page.route('**/api/speech', route => { calls++; return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloud(page);
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('calcular 2 + 5');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText('O resultado é 7.', { exact: true })).toBeVisible();
  await expect(page.getByText('Voz reproduzida: ElevenLabs.', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('checkbox', { name: /Ler respostas automaticamente no chat/ }).uncheck();
  await page.getByRole('button', { name: 'Fechar janela' }).click(); await page.reload();
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Ler respostas automaticamente no chat/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('calcular 3 + 5');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText('O resultado é 8.', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test('desligar leitura enquanto a IA responde evita geração de áudio sem perder a resposta', async ({ page }) => {
  let release = () => {}; const pending = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await page.route('**/api/chat', async route => { await pending; await route.fulfill({ json: { id: 'delayed-reply', message: 'Resposta preservada.', provider: 'groq', command: 'conversation', createdAt: new Date().toISOString() } }); });
  await page.route('**/api/speech', route => { calls++; return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloud(page);
  const requested = page.waitForRequest('**/api/chat');
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill('Quais são meus planos?');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click(); await requested;
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('checkbox', { name: /Ler respostas automaticamente no chat/ }).uncheck();
  await page.getByRole('button', { name: 'Fechar janela' }).click(); release();
  await expect(page.getByText('Resposta preservada.', { exact: true })).toBeVisible();
  expect(calls).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { speechTest: { plays: number } }).speechTest.plays)).toBe(0);
});

test('trocar Voice ID descarta o áudio anterior, valida entrada e preserva a escolha', async ({ page }) => {
  const requests: Array<{ voiceId?: string; profile: string; text: string }> = [];
  await page.route('**/api/speech', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloud(page); await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Estilo de fala' })).toHaveValue('jarvis-br');
  await page.getByRole('combobox', { name: 'Estilo de fala' }).selectOption('british');
  await page.getByRole('textbox', { name: 'Voice ID do ElevenLabs' }).fill('BritishFixtureA');
  await page.getByRole('button', { name: 'Salvar voz', exact: true }).click();
  await page.getByRole('button', { name: 'Testar ElevenLabs', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Voz reproduzida: ElevenLabs.');
  expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ voiceId: 'BritishFixtureA', profile: 'british', text: 'Good morning, sir. All systems are ready. How may I assist you today?' });
  await endAudio(page);
  await page.getByRole('button', { name: 'Testar ElevenLabs', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Voz reproduzida: ElevenLabs.'); expect(requests).toHaveLength(1);
  await page.getByRole('textbox', { name: 'Voice ID do ElevenLabs' }).fill('BritishFixtureB');
  await page.getByRole('button', { name: 'Salvar voz', exact: true }).click();
  await page.getByRole('button', { name: 'Testar ElevenLabs', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Voz reproduzida: ElevenLabs.');
  expect(requests).toHaveLength(2); expect(requests[1].voiceId).toBe('BritishFixtureB');
  await page.getByRole('textbox', { name: 'Voice ID do ElevenLabs' }).fill('https://other.test/key');
  await page.getByRole('button', { name: 'Salvar voz', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('somente o Voice ID');
  await page.getByRole('button', { name: 'Fechar janela' }).click(); await page.reload();
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Voice ID do ElevenLabs' })).toHaveValue('BritishFixtureB');
  await expect(page.getByRole('combobox', { name: 'Estilo de fala' })).toHaveValue('british');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('perfil britânico seleciona voz nativa en-GB disponível com ritmo mais calmo', async ({ page }) => {
  await cloud(page);
  await page.evaluate(() => {
    window.speechSynthesis.getVoices = () => [
      { voiceURI: 'test-pt', name: 'Português de teste', lang: 'pt-BR' },
      { voiceURI: 'test-gb', name: 'British fixture', lang: 'en-GB' },
    ] as SpeechSynthesisVoice[];
  });
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('combobox', { name: 'Estilo de fala' }).selectOption('british');
  await page.getByRole('combobox', { name: 'Tipo de voz', exact: true }).selectOption('browser');
  await page.getByRole('button', { name: 'Testar voz', exact: true }).click();
  expect(await page.evaluate(() => {
    const utterance = (window as unknown as { voiceTest: { utterance: SpeechSynthesisUtterance } }).voiceTest.utterance;
    return { lang: utterance.lang, rate: utterance.rate, voice: utterance.voice?.voiceURI };
  })).toEqual({ lang: 'en-GB', rate: 0.94, voice: 'test-gb' });
});

test('busca voz brasileira sem gerar áudio, salva a escolha e testa em português com senhor', async ({ page }) => {
  let clips = 0; const selected = 'JarvisBrazilFixture';
  await page.addInitScript(() => localStorage.setItem('jarvis.speech-profile.v1', 'british'));
  await page.route('**/api/speech/voices', route => route.fulfill({ json: { voices: [{ id: selected, name: 'JARVIS brasileiro de teste' }], matchedJarvis: true } }));
  await page.route('**/api/speech', route => { clips++; expect(route.request().postDataJSON()).toEqual({ text: 'Bom dia, senhor. Sou o Jarvis. Estou pronto para ajudar. Qual é a nossa prioridade hoje?', profile: 'jarvis-br', voiceId: selected }); return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloud(page); await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Estilo de fala' })).toHaveValue('jarvis-br');
  await page.getByRole('button', { name: 'Buscar voz JARVIS brasileira' }).click();
  const catalog = page.getByRole('region', { name: 'Vozes brasileiras encontradas' });
  await expect(catalog).toContainText('não comprova'); expect(clips).toBe(0);
  await page.getByRole('button', { name: 'Usar JARVIS brasileiro de teste' }).click();
  await expect(page.getByRole('textbox', { name: 'Voice ID do ElevenLabs' })).toHaveValue(selected);
  await expect(page.getByRole('combobox', { name: 'Tipo de voz', exact: true })).toHaveValue('elevenlabs'); expect(clips).toBe(0);
  await page.getByRole('button', { name: 'Testar ElevenLabs' }).click();
  await expect(page.getByRole('dialog')).toContainText('Voz reproduzida: ElevenLabs.'); expect(clips).toBe(1);
  await page.getByRole('button', { name: 'Fechar janela' }).click(); await page.reload();
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Voice ID do ElevenLabs' })).toHaveValue(selected);
  await expect(page.getByRole('combobox', { name: 'Estilo de fala' })).toHaveValue('jarvis-br');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('busca apresenta alternativa, ausência ou permissão necessária sem inventar a voz do filme', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech/voices', route => {
    calls++;
    return calls === 1 ? route.fulfill({ json: { voices: [{ id: 'BrazilianFixture', name: 'Voz brasileira de teste' }], matchedJarvis: false } })
      : calls === 2 ? route.fulfill({ json: { voices: [], matchedJarvis: false } })
      : route.fulfill({ status: 503, json: { error: 'A chave ElevenLabs precisa de Voices → Read para buscar vozes brasileiras.' } });
  });
  await cloud(page); await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('button', { name: 'Buscar voz JARVIS brasileira' }).click();
  await expect(page.getByRole('region', { name: 'Vozes brasileiras encontradas' })).toContainText('alternativas brasileiras');
  await page.getByRole('button', { name: 'Buscar voz JARVIS brasileira' }).click();
  await expect(page.getByRole('region', { name: 'Vozes brasileiras encontradas' })).toContainText('Não encontrei vozes brasileiras');
  await expect(page.getByRole('button', { name: 'Usar Voz brasileira de teste' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Buscar voz JARVIS brasileira' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Voices → Read');
});

test('consulta saldo esgotado sem áudio e permite usar a voz do aparelho sem chamadas ElevenLabs', async ({ page }) => {
  let clips = 0;
  await page.route('**/api/speech/quota', route => route.fulfill({ json: { used: 1000, limit: 1000, remaining: 0, nextResetAt: '2026-11-01T00:00:00.000Z' } }));
  await page.route('**/api/speech', route => { clips++; return route.fulfill({ status: 429, json: { error: 'A cota gratuita de voz foi atingida. Use a voz do aparelho.' } }); });
  await cloud(page); await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('button', { name: 'Consultar cota de voz' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Cota da conta esgotada');
  await expect(page.getByRole('dialog')).toContainText('Renovação informada pelo ElevenLabs');
  await expect(page.getByRole('dialog')).toContainText('A chave pode ter um limite menor'); expect(clips).toBe(0);
  await page.getByRole('button', { name: 'Usar voz do aparelho · sem cota ElevenLabs' }).click();
  await expect(page.getByRole('combobox', { name: 'Tipo de voz', exact: true })).toHaveValue('browser');
  await page.getByRole('button', { name: 'Testar voz', exact: true }).click();
  const utterance = await page.evaluate(() => {
    const data = (window as unknown as { voiceTest: { utterance: SpeechSynthesisUtterance } }).voiceTest.utterance;
    return { text: data.text, lang: data.lang, rate: data.rate };
  });
  expect(utterance).toEqual({ text: 'Bom dia, senhor. Sou o Jarvis. Estou pronto para ajudar. Qual é a nossa prioridade hoje?', lang: 'pt-BR', rate: 0.94 }); expect(clips).toBe(0);
  await page.getByRole('button', { name: 'Fechar janela' }).click(); await page.reload();
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tipo de voz', exact: true })).toHaveValue('browser');
});

test('saldo positivo e falha de consulta não são apresentados como créditos ilimitados', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech/quota', route => ++calls === 1 ? route.fulfill({ json: { used: 100, limit: 1000, remaining: 900 } })
    : route.fulfill({ status: 503, json: { error: 'A chave ElevenLabs precisa de User → Read para verificar o plano e a cota.' } }));
  await cloud(page); await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('button', { name: 'Consultar cota de voz' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('900 de 1.000 caracteres');
  await page.getByRole('button', { name: 'Consultar cota de voz' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('User → Read');
  await expect(page.getByRole('dialog').getByRole('status')).toHaveCount(0);
});
