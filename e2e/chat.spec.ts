import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jarvis.view.v1', 'chat'));
  await page.goto('/');
  await expect(page.getByText('Sistema online', { exact: true })).toBeVisible();
});
async function send(page: import('@playwright/test').Page, content: string) {
  await page.getByRole('textbox', { name: 'Sua mensagem para JARVIS' }).fill(content);
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
}
test('chat real, histórico após recarga e limpeza confirmada', async ({ page }) => {
  await send(page, 'calcular (12 + 8) / 2');
  await expect(page.getByText('O resultado é 10.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('O resultado é 10.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByText('O resultado é 10.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Limpar conversa' }).click();
  await expect(page.getByText('O resultado é 10.', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('O resultado é 10.', { exact: true })).toHaveCount(0);
});
test('notas sobrevivem à limpeza da conversa', async ({ page }) => {
  await send(page, 'anotar revisar portfólio');
  await expect(page.getByText('Nota salva: revisar portfólio', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Limpar conversa' }).click();
  await page.getByRole('button', { name: 'Ver minhas notas' }).click();
  await expect(page.getByText(/1\. revisar portfólio/)).toBeVisible();
  await send(page, 'apagar notas');
  await expect(page.getByText('1 nota excluída.', { exact: true })).toBeVisible();
});
test('pedido falho preserva o texto e permite nova tentativa', async ({ page }) => {
  await page.route('**/api/chat', route => route.abort());
  await send(page, 'hora');
  await expect(page.getByRole('alert')).toContainText('Sem conexão');
  await expect(page.getByRole('textbox')).toHaveValue('hora');
  await page.unroute('**/api/chat');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText(/Agora são/)).toBeVisible();
});
test('fallback sem voz, teclado, diálogo e preferências persistidas', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Preferências' }).click(); await expect(page.getByText(/Reconhecimento de voz indisponível neste navegador/)).toBeVisible(); await page.getByRole('button', { name: 'Fechar janela' }).click();
  await page.getByRole('textbox').fill('ajuda');
  await page.getByRole('textbox').press('Enter');
  await expect(page.getByText(/Posso ajudar com estes comandos/)).toBeVisible();
  await page.getByRole('button', { name: 'Preferências' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('checkbox', { name: /Ler respostas automaticamente/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Preferências' }).click();
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: /Ler respostas automaticamente/ })).toBeChecked();
});
test('recusa do microfone não impede a digitação', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Ativar microfone' }).click();
  await expect(page.getByRole('alert')).toContainText('Permissão do microfone negada');
  await send(page, 'data');
  await expect(page.getByText(/Hoje é/)).toBeVisible();
});
test('layout não transborda e respeita movimento reduzido', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.jd-orb canvas')).toHaveAttribute('data-paused', 'true');
  await page.screenshot({ path: `test-results/jarvis-${test.info().project.name}.png`, fullPage: true });
});
