import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Sistema online', { exact: true })).toBeVisible();
});
test('captura áudio real do dispositivo de teste, reproduz e libera o microfone', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      (window as unknown as { testTracks: MediaStreamTrack[] }).testTracks = stream.getTracks();
      return stream;
    };
  });
  await page.reload();
  await page.getByRole('button', { name: 'Ativar microfone' }).click();
  await expect(page.getByRole('button', { name: 'Parar gravação' })).toBeVisible();
  await page.waitForTimeout(600); // Produce audio frames in the real MediaRecorder.
  await page.getByRole('button', { name: 'Parar gravação' }).click();
  const audio = page.locator('audio');
  await expect(audio).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  await audio.evaluate(async element => { await (element as HTMLAudioElement).play(); (element as HTMLAudioElement).pause(); });
  expect(await page.evaluate(() => (window as unknown as { testTracks: MediaStreamTrack[] }).testTracks.every(track => track.readyState === 'ended'))).toBe(true);
  await page.getByRole('button', { name: 'Descartar gravação' }).click();
  await expect(audio).toHaveCount(0);
});
test('transcrição simulada é revisável e nunca é enviada automaticamente', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onresult?: (event: unknown) => void;
      onend?: () => void;
      start() {
        setTimeout(() => {
          this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'calcular 5 + 5' } }] });
          this.onend?.();
        }, 100);
      }
      stop() { this.onend?.(); }
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Recognition, configurable: true });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Ativar microfone' }).click();
  await expect(page.getByRole('textbox')).toHaveValue('calcular 5 + 5');
  await expect(page.getByText('O resultado é 10.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText('O resultado é 10.', { exact: true })).toBeVisible();
});
test('solicitação de microfone pendente pode ser cancelada', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => new Promise(() => {}) });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Ativar microfone' }).click();
  await page.getByRole('button', { name: 'Cancelar solicitação do microfone' }).click();
  await expect(page.getByRole('button', { name: 'Ativar microfone' })).toBeEnabled();
  await page.getByRole('textbox').fill('hora');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText(/Agora são/)).toBeVisible();
});
test('síntese simulada recebe o texto e pode ser interrompida', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { text: '', canceled: false };
    (window as unknown as { testSpeech: typeof state }).testSpeech = state;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() { state.canceled = true; },
      getVoices() { return []; },
      speak(utterance: SpeechSynthesisUtterance) { state.text = utterance.text; state.canceled = false; utterance.onstart?.(new Event('start') as SpeechSynthesisEvent); },
    } });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Ouvir resposta' }).click();
  expect(await page.evaluate(() => (window as unknown as { testSpeech: { text: string } }).testSpeech.text)).toContain('Olá, sou o JARVIS');
  await page.getByRole('button', { name: 'Parar leitura', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { testSpeech: { canceled: boolean } }).testSpeech.canceled)).toBe(true);
});
async function pressGamepad(page: Page, index: number) {
  await page.evaluate(async index => {
    const state = (window as unknown as { testPad: { buttons: { pressed: boolean }[] } }).testPad;
    state.buttons[index].pressed = true;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    state.buttons[index].pressed = false;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, index);
}
test('controle simulado navega com direcional, ativa com A e fecha com B', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { mapping: 'standard', buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
    (window as unknown as { testPad: typeof pad }).testPad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
  });
  await page.reload();
  await expect(page.getByText('Controle detectado · A para ativar')).toBeVisible();
  await page.getByRole('button', { name: 'Assistente', exact: true }).focus();
  await pressGamepad(page, 13);
  await expect(page.getByRole('button', { name: 'Minhas notas' })).toBeFocused();
  await pressGamepad(page, 13);
  await expect(page.getByRole('button', { name: 'Comandos', exact: true })).toBeFocused();
  await pressGamepad(page, 0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await pressGamepad(page, 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Comandos', exact: true })).toBeFocused();
});
