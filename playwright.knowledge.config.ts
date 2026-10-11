import { defineConfig } from '@playwright/test';
import personal from './playwright.personal.config';
export default defineConfig({ ...personal, testDir: './e2e-knowledge', outputDir: 'test-results-knowledge' });
