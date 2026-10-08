import { test, expect } from '@playwright/test';
import { prepare, completeRecognition } from './voice-cases';

test('interrupção cancela pedido pendente e uma resposta atrasada não volta a falar', async ({ page }) => {
  await prepare(page);
  let releaseResponse: () => void = () => {};
  const responseReady = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route('**/api/chat', async route => {
    await responseReady;
    await route.fulfill({ json: { id: 'late-response', message: 'Resposta atrasada', createdAt: new Date().toISOString(), provider: 'local' } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Falar com JARVIS' }).click();
  await expect(page.getByRole('status')).toContainText('À escuta');
  const responseSent = page.waitForRequest('**/api/chat');
  await completeRecognition(page, 'hora');
  const originalRequest = await responseSent;
  await expect(page.getByRole('status')).toContainText('Processando');
  const aborted = page.waitForEvent('requestfailed', request => request === originalRequest);
  await page.getByRole('button', { name: 'Interromper resposta' }).click();
  await aborted;
  releaseResponse();
  await expect(page.getByRole('button', { name: 'Falar com JARVIS' })).toBeVisible();
  await expect(page.locator('.scene-reply')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { voiceTest: { spoken: string[] } }).voiceTest.spoken)).toEqual([]);
  await page.unroute('**/api/chat');
  await page.getByRole('button', { name: 'Digitar mensagem' }).click();
  await page.getByRole('textbox').fill('calcular 2 + 3');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.locator('.scene-reply')).toContainText('O resultado é 5.');
});
