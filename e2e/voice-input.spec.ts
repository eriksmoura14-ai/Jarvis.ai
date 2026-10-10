import { expect, test } from '@playwright/test';
import { completeRecognition, prepare } from './voice-cases';

test('eventos atrasados de uma escuta concluída não reabrem microfone nem alteram a resposta', async ({ page }) => {
  await prepare(page);
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/chat') && request.method() === 'POST') requests++; });
  await page.getByRole('button', { name: 'Falar com JARVIS', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('À escuta');
  await completeRecognition(page, 'calcular dois mais cinco');
  await expect(page.getByRole('status')).toContainText('Falando');
  // Deterministically reproduce the late onstart that raced the end event in CI.
  await page.evaluate(() => {
    const state = (window as unknown as { voiceTest: { recognition: { onstart: () => void } } }).voiceTest;
    state.recognition.onstart();
  });
  await expect(page.getByRole('status')).toContainText('Falando');
  await expect(page.getByRole('button', { name: 'Interromper resposta', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = (window as unknown as { voiceTest: { recognition: { onresult: (event: unknown) => void; onerror: (event: { error: string }) => void; onend: () => void } } }).voiceTest;
    state.recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'fala atrasada que deve ser ignorada' } }] });
    state.recognition.onerror({ error: 'network' });
    state.recognition.onend();
  });
  await expect(page.getByRole('status')).toContainText('Falando');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.scene-transcript')).toContainText('calcular dois mais cinco');
  await expect(page.locator('.scene-transcript')).not.toContainText('fala atrasada');
  expect(requests).toBe(1);
});
