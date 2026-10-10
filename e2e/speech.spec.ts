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
  await expect(page.getByRole('status')).toContainText('À escuta');
  await completeRecognition(page, 'calcular dois mais cinco');
  await expect(page.locator('.scene-reply')).toContainText('O resultado é 7.');
}
async function endAudio(page: Page) {
  await page.evaluate(() => (window as unknown as { speechTest: { player: { onended: () => void } } }).speechTest.player.onended());
}

test('voz por IA usa a API protegida e reprodução MP3, sem síntese nativa', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech', async route => {
    calls++; expect(route.request().headers()['x-jarvis-client']).toBe('1');
    expect(route.request().postDataJSON()).toEqual({ text: 'O resultado é 7.' });
    await route.fulfill({ contentType: 'audio/mpeg', body: mp3 });
  });
  await cloud(page); await response(page);
  await expect(page.getByRole('status')).toContainText('Falando');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
  await endAudio(page);
  await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvir resposta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Falando'); expect(calls).toBe(1);
});

test('Chromium decodifica e conclui um MP3 real pelo caminho de áudio por IA', async ({ page }) => {
  await page.route('**/api/speech', route => route.fulfill({ contentType: 'audio/mpeg', body: mp3 }));
  await cloud(page, false); await response(page);
  await expect(page.getByRole('status')).toContainText('Falando');
  await expect(page.getByRole('button', { name: 'Falar com JARVIS', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('cota gratuita esgotada tenta a voz nativa e preserva o texto', async ({ page }) => {
  await page.route('**/api/speech', route => route.fulfill({ status: 429, json: { error: 'A cota gratuita de voz foi atingida.' } }));
  await cloud(page); await response(page);
  await expect(page.getByRole('status')).toContainText('Falando');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual(['O resultado é 7.']);
  await page.evaluate(() => (window as unknown as { voiceTest: { utterance: { onend: () => void } } }).voiceTest.utterance.onend());
  await expect(page.locator('.scene-prompt')).toContainText('Usando a voz do aparelho');
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
  await expect(page.locator('.scene-reply')).toContainText('O resultado é 7.');
});

test('bloqueio de reprodução permite toque para ouvir o mesmo áudio sem consumir novamente', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/speech', route => { calls++; return route.fulfill({ contentType: 'audio/mpeg', body: mp3 }); });
  await cloud(page);
  await page.evaluate(() => { (window as unknown as { speechTest: { blocked: boolean } }).speechTest.blocked = true; });
  await response(page); await expect(page.getByRole('alert')).toContainText('Ouvir resposta');
  await page.evaluate(() => { (window as unknown as { speechTest: { blocked: boolean } }).speechTest.blocked = false; });
  await page.getByRole('button', { name: 'Ouvir resposta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Falando'); expect(calls).toBe(1);
});

test('conversa contínua espera o áudio e interromper pausa a reprodução', async ({ page }) => {
  await page.route('**/api/speech', route => route.fulfill({ contentType: 'audio/mpeg', body: mp3 }));
  await cloud(page); await page.getByRole('checkbox', { name: /Conversa contínua/ }).check(); await response(page);
  await expect(page.getByRole('status')).toContainText('Falando');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { starts: number } }).voiceTest.starts)).toBe(1);
  await endAudio(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { voiceTest: { starts: number } }).voiceTest.starts)).toBe(2);
  await completeRecognition(page, 'calcular dois mais cinco'); await expect(page.getByRole('status')).toContainText('Falando');
  await page.getByRole('button', { name: 'Interromper resposta' }).click();
  await expect(page.getByRole('checkbox', { name: /Conversa contínua/ })).not.toBeChecked();
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
  await expect(page.locator('.scene-reply')).toContainText('O resultado é 7.');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
});

test('modo ElevenLabs preservado informa quando servidor não tem voz configurada', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.speech-engine.v1', 'elevenlabs'));
  await prepare(page);
  await response(page);
  await expect(page.getByRole('alert')).toContainText('não está configurado');
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
});
