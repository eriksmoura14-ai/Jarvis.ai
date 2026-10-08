import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './e2e-pages',
  outputDir: 'test-results-pages',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4173/Jarvis.ai/' },
  webServer: { command: 'npm run preview:pages', url: 'http://127.0.0.1:4173/Jarvis.ai/', reuseExistingServer: false, timeout: 30_000 },
});
