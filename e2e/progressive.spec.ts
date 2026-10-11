import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { prepare, completeRecognition } from './voice-cases';

const first = 'Uma conversa natural precisa de contexto, frases claras e tempo para você responder.';
const second = ' Podemos melhorar cada etapa aos poucos e conferir o resultado no seu celular, sem prometer velocidade que ainda não foi medida.';
const answer = first + second;
const mp3 = readFileSync(new URL('./fixtures/tone.mp3', import.meta.url));
const result = (message = answer) => ({ id: 'progressive-reply', message, provider: 'groq', command: 'conversation', createdAt: new Date().toISOString(), timings: { preparationMs: 12, answerMs: 320, saveMs: 10, totalMs: 342 } });

async function type(page: Page) {
  await page.getByRole('button', { name: 'Digitar mensagem' }).click();
  await page.getByRole('textbox').fill('Como conversar melhor?');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
}
async function streamFixture(page: Page) {
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', provider: 'groq', version: '0.1.0', streaming: true } }));
  await page.addInitScript(() => {
    const original = window.fetch;
    const state = { stream: null as ReadableStreamDefaultController<Uint8Array> | null, canceled: false, signal: null as AbortSignal | null };
    window.fetch = async (input, options) => {
      if (String(input) !== '/api/chat') return original(input, options);
      state.signal = options?.signal ?? null;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        state.stream = controller;
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'ready' }) + '\n' + JSON.stringify({ type: 'text', text: 'Começo da resposta.' }) + '\n'));
      }, cancel() { state.canceled = true; } });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
    (window as unknown as { progressTest: typeof state }).progressTest = state;
  });
  await prepare(page);
}
async function finishStream(page: Page, value: unknown) {
  await page.evaluate(value => {
    const state = (window as unknown as { progressTest: { stream: ReadableStreamDefaultController<Uint8Array> } }).progressTest;
    state.stream.enqueue(new TextEncoder().encode(JSON.stringify(value) + '\n')); state.stream.close();
  }, value);
}

test('texto progressivo aparece antes do fim, sem salvar ou falar o rascunho', async ({ page }) => {
  await streamFixture(page); await type(page);
  await expect(page.locator('.scene-reply')).toContainText('Começo da resposta.');
  await expect(page.getByRole('status')).toContainText('Processando');
  await expect(page.getByRole('button', { name: 'Ouvir resposta', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('jarvis.history.v1'))).not.toContain('Começo da resposta.');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
  await finishStream(page, { type: 'result', response: result('Resposta final confirmada.') });
  await expect(page.locator('.scene-reply')).toContainText('Resposta final confirmada.');
  await expect(page.locator('.scene-reply')).not.toContainText('Começo da resposta.');
  await expect(page.getByRole('button', { name: 'Ouvir resposta', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preferências' }).click();
  const timings = page.getByRole('region', { name: 'Tempos da conversa' });
  await expect(timings).toContainText('Primeiro texto na tela');
  await expect(timings).toContainText('0.32 s');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('erro após texto parcial remove o rascunho, não fala e devolve a pergunta', async ({ page }) => {
  await streamFixture(page); await type(page);
  await expect(page.locator('.scene-reply')).toContainText('Começo da resposta.');
  await finishStream(page, { type: 'error', error: 'Sua memória mudou enquanto eu respondia.' });
  await expect(page.getByRole('alert')).toContainText('Sua memória mudou');
  await expect(page.getByRole('textbox')).toHaveValue('Como conversar melhor?');
  await expect(page.locator('.scene-reply')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('jarvis.history.v1'))).not.toContain('Começo da resposta.');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
});

test('interromper texto progressivo cancela o leitor e impede fala tardia', async ({ page }) => {
  await streamFixture(page); await type(page);
  await expect(page.locator('.scene-reply')).toContainText('Começo da resposta.');
  await page.getByRole('button', { name: 'Interromper resposta' }).click();
  await expect(page.locator('.scene-reply')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { progressTest: { canceled: boolean } }).progressTest.canceled)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { progressTest: { signal: AbortSignal } }).progressTest.signal.aborted)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
});

test('trocar estilo cancela resposta pendente para impedir áudio com preferências antigas', async ({ page }) => {
  await streamFixture(page); await type(page);
  await expect(page.locator('.scene-reply')).toContainText('Começo da resposta.');
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('combobox', { name: 'Estilo de fala', exact: true }).selectOption('natural');
  await expect.poll(() => page.evaluate(() => (window as unknown as { progressTest: { canceled: boolean } }).progressTest.canceled)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { progressTest: { signal: AbortSignal } }).progressTest.signal.aborted)).toBe(true);
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await expect(page.locator('.scene-reply')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
});

async function cloudFixture(page: Page) {
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', provider: 'groq', version: '0.1.0', streaming: true, speech: { configured: true, provider: 'elevenlabs' } } }));
  await page.route('**/api/chat', route => route.fulfill({ json: result() }));
  await page.addInitScript(() => {
    localStorage.setItem('jarvis.speech-engine.v1', 'elevenlabs');
    const state = { player: null as FakeAudio | null, plays: 0, blocked: false };
    class FakeAudio {
      onplaying: (() => void) | null = null; onended: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(public src: string) { state.player = this; }
      play() { state.plays++; if (state.blocked) return Promise.reject(new DOMException('blocked', 'NotAllowedError')); this.onplaying?.(); return Promise.resolve(); }
      pause() {} removeAttribute() { this.src = ''; } load() {}
    }
    Object.defineProperty(window, 'Audio', { configurable: true, value: FakeAudio });
    (window as unknown as { audioPartsTest: typeof state }).audioPartsTest = state;
  });
  await prepare(page);
}
async function endAudio(page: Page) {
  await page.evaluate(() => (window as unknown as { audioPartsTest: { player: { onended: () => void } } }).audioPartsTest.player.onended());
}
const plays = (page: Page) => page.evaluate(() => (window as unknown as { audioPartsTest: { plays: number } }).audioPartsTest.plays);

test('segunda parte é preparada durante a primeira, espera a reprodução e reaproveita o cache', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/speech', route => { requests.push(route.request().postDataJSON().text); return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloudFixture(page); await type(page);
  await expect(page.getByRole('status')).toContainText('Falando');
  await expect.poll(() => requests.length).toBe(2); expect(requests).toEqual([first, second.trim()]);
  expect(await plays(page)).toBe(1);
  await page.evaluate(() => {
    const player = (window as unknown as { audioPartsTest: { player: { onplaying: () => void } } }).audioPartsTest.player;
    player.onplaying(); player.onplaying();
  });
  expect(requests).toHaveLength(2);
  await endAudio(page); await expect.poll(() => plays(page)).toBe(2);
  await endAudio(page); await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvir resposta', exact: true }).click();
  await expect.poll(() => plays(page)).toBe(3); await endAudio(page); await expect.poll(() => plays(page)).toBe(4);
  expect(requests).toHaveLength(2); await endAudio(page);
});

test('cancelar a primeira parte cancela preparação da segunda e não reproduz áudio atrasado', async ({ page }) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  await page.route('**/api/speech', async route => { if (++calls === 2) await gate; await route.fulfill({ contentType: 'audio/mpeg', body: mp3 }).catch(() => {}); });
  await cloudFixture(page);
  const secondRequested = page.waitForRequest(request => request.url().endsWith('/api/speech') && request.postDataJSON().text !== first);
  await type(page); const requested = await secondRequested;
  await endAudio(page);
  await expect(page.getByRole('status')).toContainText('Processando');
  await expect(page.getByRole('button', { name: 'Interromper resposta' })).toBeVisible();
  const canceled = page.waitForEvent('requestfailed', request => request === requested);
  await page.getByRole('button', { name: 'Interromper resposta' }).click(); await canceled; release();
  await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible();
  expect(await plays(page)).toBe(1); await expect(page.locator('.scene-reply')).toContainText(answer);
});

test('reprodução bloqueada reaproveita a primeira parte ao tocar e gera somente a segunda', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/speech', route => { requests.push(route.request().postDataJSON().text); return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloudFixture(page); await page.evaluate(() => { (window as unknown as { audioPartsTest: { blocked: boolean } }).audioPartsTest.blocked = true; });
  await type(page); await expect(page.getByRole('alert')).toContainText('Ouvir resposta');
  expect(requests).toEqual([first]);
  await page.evaluate(() => { (window as unknown as { audioPartsTest: { blocked: boolean } }).audioPartsTest.blocked = false; });
  await page.getByRole('button', { name: 'Ouvir resposta', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2); expect(requests).toEqual([first, second.trim()]);
  await endAudio(page); await expect.poll(() => plays(page)).toBe(3); await endAudio(page);
});

test('comando de interrupção ignora fala comum e para sem enviar reconhecimento ao chat', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.voice-interrupt.v1', 'true'));
  await prepare(page);
  let calls = 0; page.on('request', request => { if (request.url().endsWith('/api/chat')) calls++; });
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { starts: number } }).voiceTest.starts)).toBe(0);
  await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
  await expect(page.getByRole('status')).toContainText('À escuta'); await completeRecognition(page, 'calcular dois mais cinco');
  await expect(page.getByRole('status')).toContainText('Falando');
  await expect.poll(() => page.evaluate(() => (window as unknown as { voiceTest: { starts: number } }).voiceTest.starts)).toBe(2);
  await page.evaluate(() => {
    const state = (window as unknown as { voiceTest: { recognition: { onresult: (event: unknown) => void } } }).voiceTest;
    state.recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'O resultado é sete' } }] });
  });
  await expect(page.getByRole('status')).toContainText('Falando');
  await completeRecognition(page, 'Jarvis, pare.');
  await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible();
  await expect(page.locator('.scene-prompt')).toContainText('interrompida pela sua voz'); expect(calls).toBe(1);
});

test('falha na segunda parte em modo ElevenLabs preserva texto sem repetir pedido ou usar voz nativa', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech', route => ++calls === 1 ? route.fulfill({ contentType: 'audio/mpeg', body: mp3 }) : route.fulfill({ status: 429, json: { error: 'A cota gratuita da segunda parte acabou.' } }));
  await cloudFixture(page); await type(page);
  await expect.poll(() => calls).toBe(2); await expect(page.getByRole('status')).toContainText('Falando');
  await endAudio(page); await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible();
  await expect(page.locator('.scene-prompt')).toContainText('cota gratuita');
  expect(calls).toBe(2); expect(await plays(page)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
  await expect(page.locator('.scene-reply')).toContainText(answer);
});

test('eco de comando citado pela resposta não interrompe a própria voz', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.voice-interrupt.v1', 'true'));
  await page.route('**/api/chat', route => route.fulfill({ json: result('Você pode dizer Jarvis pare para interromper a resposta, ou usar o botão central.') }));
  await prepare(page);
  await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
  await expect(page.getByRole('status')).toContainText('À escuta'); await completeRecognition(page, 'Explique a interrupção');
  await expect(page.getByRole('status')).toContainText('Falando');
  await expect.poll(() => page.evaluate(() => (window as unknown as { voiceTest: { starts: number } }).voiceTest.starts)).toBe(2);
  await page.evaluate(() => {
    const state = (window as unknown as { voiceTest: { recognition: { onresult: (event: unknown) => void } } }).voiceTest;
    state.recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Jarvis, pare' } }] });
  });
  await expect(page.getByRole('status')).toContainText('Falando');
  await completeRecognition(page, 'Jarvis, pausa');
  await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible();
});

test('falha na preparação antecipada em modo automático conclui por voz nativa sem repetir a API', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech', route => ++calls === 1 ? route.fulfill({ contentType: 'audio/mpeg', body: mp3 }) : route.fulfill({ status: 429, json: { error: 'A cota gratuita da segunda parte acabou.' } }));
  await cloudFixture(page);
  await page.getByRole('button', { name: 'Preferências' }).click();
  await page.getByRole('combobox', { name: 'Tipo de voz', exact: true }).selectOption('auto');
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await type(page); await expect.poll(() => calls).toBe(2);
  await endAudio(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([second.trim()]);
  expect(calls).toBe(2); expect(await plays(page)).toBe(1);
  await expect(page.getByRole('status')).toContainText('Falando');
});

test('recepção pessoal, notícias opcionais com fontes e uma consulta automática por dia', async ({ page }) => {
  const snapshot = { history: [] as unknown[], memories: [{ id: 'name', content: 'meu nome é Erik', createdAt: new Date().toISOString() }, { id: 'address', content: 'me chame de senhor', createdAt: new Date().toISOString() }], notes: [], generation: 0, storage: 'sqlite' };
  await page.route('**/api/personal/session', route => route.fulfill({ json: { enabled: true, authenticated: true, storage: 'sqlite' } }));
  await page.route('**/api/personal/data', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', provider: 'local', version: '0.1.0', webSearch: { enabled: true } } }));
  let calls = 0;
  await page.route('**/api/chat', route => {
    calls++;
    expect(route.request().postDataJSON()).toMatchObject({ message: 'pesquise últimas notícias sobre astronomia', webSearch: true });
    const reply = { ...result('Encontrei uma fonte sobre astronomia. Confira a data no link.'), command: 'search', provider: 'local', sources: [{ title: 'NASA', url: 'https://www.nasa.gov/', snippet: 'Astronomia e pesquisa.' }], webSearch: { query: 'últimas notícias sobre astronomia', engine: 'bing', searchedAt: new Date().toISOString() } };
    snapshot.history = [{ id: reply.id, role: 'assistant', content: reply.message, createdAt: reply.createdAt, sources: reply.sources, webSearch: reply.webSearch }];
    return route.fulfill({ json: reply });
  });
  await prepare(page);
  await expect(page.getByRole('region', { name: 'Recepção pessoal' })).toContainText(', senhor.');
  await page.getByRole('button', { name: 'Preferências' }).click();
  await expect(page.getByRole('checkbox', { name: /Buscar notícias ao abrir/ })).not.toBeChecked(); expect(calls).toBe(0);
  await page.getByRole('checkbox', { name: /Buscar notícias ao abrir/ }).check();
  await page.getByLabel('Assunto das notícias').fill('astronomia');
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await expect.poll(() => calls).toBe(1);
  await expect(page.locator('.scene-reply')).toContainText('astronomia');
  await expect(page.getByRole('link', { name: 'NASA', exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { starts: number; spoken: string[] } }).voiceTest)).toMatchObject({ starts: 0, spoken: [] });
  await page.reload(); await expect(page.getByRole('region', { name: 'Recepção pessoal' })).toContainText(', senhor.');
  await page.waitForTimeout(1800); expect(calls).toBe(1);
  await page.setViewportSize({ width: 320, height: 720 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
