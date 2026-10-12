import { continuous, expectStoppedContinuous, history, mode } from './ui';
import { test, expect, type Page } from '@playwright/test';

export async function prepare(page: Page, options: { recognitionError?: string; speechError?: boolean; unsupported?: boolean } = {}) {
  await page.addInitScript(options => {
    const state = {
      starts: 0, aborts: 0, captures: 0, spoken: [] as string[],
      recognition: null as Recognition | null,
      utterance: null as Utterance | null,
      speechError: !!options.speechError,
    };
    class Utterance {
      lang = ''; rate = 1; voice: unknown = null;
      onstart?: (event: unknown) => void;
      onend?: () => void;
      onerror?: (event: { error: string }) => void;
      constructor(public text: string) {}
    }
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onstart?: () => void;
      onresult?: (event: unknown) => void;
      onend?: () => void;
      onerror?: (event: { error: string }) => void;
      start() {
        state.starts++;
        state.recognition = this;
        setTimeout(() => {
          if (options.recognitionError) this.onerror?.({ error: options.recognitionError });
          else this.onstart?.();
        }, 10);
      }
      stop() { this.onend?.(); }
      abort() { state.aborts++; }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: options.unsupported ? undefined : Recognition });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'test-pt', name: 'Português de teste', lang: 'pt-BR' }],
      speak(utterance: Utterance) {
        state.utterance = utterance;
        state.spoken.push(utterance.text);
        if (state.speechError) utterance.onerror?.({ error: 'not-allowed' });
        else utterance.onstart?.(new Event('start'));
      },
      cancel() { state.utterance = null; },
    } });
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { state.captures++; return Promise.reject(new Error('Voice mode must not open a recorder')); };
    (window as unknown as { voiceTest: typeof state }).voiceTest = state;
  }, options);
  await page.goto('./');
  await expect(page.getByText(/^(Modo navegador|Sistema online)$/)).toBeVisible();
}
export async function completeRecognition(page: Page, text: string) {
  await page.evaluate(text => {
    const state = (window as unknown as { voiceTest: { recognition: { onresult: (event: unknown) => void; onend: () => void } } }).voiceTest;
    state.recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
    state.recognition.onend();
  }, text);
}
async function completeSpeech(page: Page) {
  await page.evaluate(() => (window as unknown as { voiceTest: { utterance: { onend: () => void } } }).voiceTest.utterance.onend());
}
async function starts(page: Page) {
  return page.evaluate(() => (window as unknown as { voiceTest: { starts: number } }).voiceTest.starts);
}

export function voiceCases() {
  test('abre Moderna sem ativar microfone; layout atende celular e paisagem', async ({ page }) => {
    await prepare(page);
    await expect(page.locator('#jarvis-moderno')).toBeVisible();
    await expect(page.locator('.jd-sidebar')).toBeVisible();
    expect(await starts(page)).toBe(0);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Ir para o assistente' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    for (const size of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Falar com JARVIS' })).toBeVisible();
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.jd-orb canvas')).toHaveAttribute('data-paused', 'true');
    await page.setViewportSize(test.info().project.use.viewport ?? { width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath('jarvis-voice.png'), fullPage: true });
  });
  test('fala gera um pedido, lê a resposta e mantém histórico sem abrir outro microfone', async ({ page }) => {
    await prepare(page);
    await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
    await expect(page.getByRole('status')).toContainText('Ouvindo você');
    await completeRecognition(page, 'Jarvis, calcular dois mais cinco.');
    await expect(page.locator('.jd-message-log .message-assistant').last()).toContainText('O resultado é 7.');
    await expect(page.getByRole('status')).toContainText('Respondendo');
    expect(await page.evaluate(() => (window as unknown as { voiceTest: { captures: number; spoken: string[] } }).voiceTest)).toMatchObject({ captures: 0, spoken: ['O resultado é 7.'] });
    await completeSpeech(page);
    await expect(page.getByRole('button', { name: 'Falar com JARVIS' })).toBeVisible();
    expect(await starts(page)).toBe(1);
    await history(page);
    await expect(page.getByRole('dialog')).toContainText('Jarvis, calcular dois mais cinco.');
    await expect(page.getByRole('dialog')).toContainText('O resultado é 7.');
    await page.getByRole('button', { name: 'Fechar janela' }).click();
    await page.reload();
    await expect(page.locator('.jd-message-log .message-assistant').last()).toContainText('O resultado é 7.');
  });
  test('conversa contínua espera a voz terminar e Escape impede novas escutas', async ({ page }) => {
    await prepare(page);
    await continuous(page);
    await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
    await expect(page.getByRole('status')).toContainText('Ouvindo você');
    await completeRecognition(page, 'hora');
    await expect(page.getByRole('status')).toContainText('Respondendo');
    await page.waitForTimeout(450);
    expect(await starts(page)).toBe(1);
    await completeSpeech(page);
    await expect.poll(() => starts(page)).toBe(2);
    await page.keyboard.press('Escape');
    await expectStoppedContinuous(page);
    await expect(page.getByRole('button', { name: 'Falar com JARVIS' })).toBeVisible();
    await completeRecognition(page, 'anotar não deve ser enviado');
    await expect(page.locator('.jd-message-log .message-assistant').last()).not.toContainText('Nota salva: não deve ser enviado');
    expect(await starts(page)).toBe(2);
  });
  test('permissão negada e reconhecimento ausente mantêm digitação utilizável', async ({ page }) => {
    await prepare(page, { recognitionError: 'not-allowed' });
    await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
    await expect(page.getByRole('alert')).toContainText('Permissão do microfone negada');
    await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).focus();
    await page.getByRole('textbox').fill('data');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(page.locator('.jd-message-log .message-assistant').last()).toContainText('Hoje é');
    await prepare(page, { unsupported: true });
    await expect(page.getByRole('button', { name: 'Falar com JARVIS' })).toBeDisabled();
    await expect(page.getByRole('textbox')).toBeVisible();
  });
  test('botão central interrompe a resposta falada sem retomar a escuta', async ({ page }) => {
    await prepare(page);
    await continuous(page);
    await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
    await expect(page.getByRole('status')).toContainText('Ouvindo você');
    await completeRecognition(page, 'calcular 6 + 2');
    await expect(page.getByRole('status')).toContainText('Respondendo');
    await page.evaluate(() => {
      const state = window as unknown as { voiceTest: { utterance: { onend: () => void } }; lateEnd: () => void };
      state.lateEnd = state.voiceTest.utterance.onend;
    });
    await page.getByRole('button', { name: 'Interromper resposta' }).click();
    await page.evaluate(() => (window as unknown as { lateEnd: () => void }).lateEnd());
    await expectStoppedContinuous(page);
    await expect(page.getByRole('button', { name: 'Falar com JARVIS' })).toBeVisible();
    await page.waitForTimeout(450);
    expect(await starts(page)).toBe(1);
    await expect(page.locator('.jd-message-log .message-assistant').last()).toContainText('O resultado é 8.');
    await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
    await expect.poll(() => starts(page)).toBe(2);
  });
  test('trocar de aplicativo pausa microfone e ignora resultados atrasados', async ({ page }) => {
    await prepare(page);
    await continuous(page);
    await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
    await expect(page.getByRole('status')).toContainText('Ouvindo você');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expectStoppedContinuous(page);
    await completeRecognition(page, 'anotar não enviar ao sair');
    await expect(page.locator('.jd-message-log .message-assistant').last()).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { voiceTest: { aborts: number } }).voiceTest.aborts)).toBeGreaterThan(0);
  });
  test('voz bloqueada preserva resposta em texto e desativa repetição automática', async ({ page }) => {
    await prepare(page, { speechError: true });
    await continuous(page);
    await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
    await expect(page.getByRole('status')).toContainText('Ouvindo você');
    await completeRecognition(page, 'calcular 3 * 4');
    await expect(page.locator('.jd-message-log .message-assistant').last()).toContainText('O resultado é 12.');
    await expect(page.getByRole('alert')).toContainText('A voz não foi reproduzida');
    await expectStoppedContinuous(page);
    await page.waitForTimeout(450);
    expect(await starts(page)).toBe(1);
    await page.evaluate(() => { (window as unknown as { voiceTest: { speechError: boolean } }).voiceTest.speechError = false; });
    await page.getByRole('button', { name: 'Ouvir resposta', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Respondendo');
  });
  test('modo chat permanece acessível e a escolha de tela sobrevive à recarga', async ({ page }) => {
    await prepare(page);
    await mode(page, 'chat');
    await expect(page.getByRole('button', { name: 'Ativar microfone' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Ativar microfone' })).toBeVisible();
    await mode(page, 'voice');
    await expect(page.locator('#jarvis-moderno')).toBeVisible();
    await page.reload();
    await expect(page.locator('#jarvis-moderno')).toBeVisible();
  });
}
