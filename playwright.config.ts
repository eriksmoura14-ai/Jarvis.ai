import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const production = process.env.E2E_PRODUCTION === '1';
const url = production ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:5173';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: url,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--no-sandbox', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: production ? 'npm start' : 'npm run dev',
    url,
    reuseExistingServer: false,
    env: { DATABASE_PATH: `/tmp/jarvis-e2e-${process.pid}.sqlite` },
    timeout: 30_000,
  },
});
