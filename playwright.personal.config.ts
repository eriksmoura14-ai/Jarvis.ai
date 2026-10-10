import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './e2e-personal',
  outputDir: 'test-results-personal',
  webServer: {
    command: process.env.E2E_PRODUCTION === '1' ? 'npm start' : 'npm run dev',
    url: process.env.E2E_PRODUCTION === '1' ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:5173',
    reuseExistingServer: false, timeout: 30_000,
    env: { DATABASE_PATH: `/tmp/jarvis-personal-e2e-${process.pid}.sqlite`,
      JARVIS_PASSWORD: 'fixture-local-personal-123', NODE_ENV: 'development', RENDER: '',
      SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', AI_PROVIDER: 'local' },
  },
});
