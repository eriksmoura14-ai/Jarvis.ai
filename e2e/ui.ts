import { expect, type Page } from '@playwright/test';

export async function settings(page: Page) {
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
}
export async function mode(page: Page, value: 'chat' | 'voice') {
  await settings(page);
  await page.getByRole('button', { name: value === 'chat' ? 'Abrir modo chat' : 'Abrir modo voz', exact: true }).click();
}
export async function continuous(page: Page) {
  await settings(page);
  await page.getByRole('checkbox', { name: /Conversa contínua/ }).check();
  await page.getByRole('button', { name: 'Fechar janela' }).click();
}
export async function expectStoppedContinuous(page: Page) {
  await expect(page.locator('#jarvis-moderno')).toHaveAttribute('data-continuous', 'false');
}
export async function history(page: Page) {
  await settings(page);
  await page.getByRole('button', { name: 'Abrir histórico', exact: true }).click();
}
export async function knowledge(page: Page) {
  await settings(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Notas do Obsidian', exact: true }).click();
}
export async function plan(page: Page) {
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click();
  await page.getByRole('button', { name: 'Planejar meu dia', exact: true }).click();
}
