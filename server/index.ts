import { buildApp } from './app.js';
import { readAIConfig } from './providers/model.js';
import { readPersonalConfig } from './personal/auth.js';

const app = await buildApp({ logger: true, serveWeb: true, ai: readAIConfig(process.env),
  personal: readPersonalConfig(process.env),
  aiDailyLimit: Number(process.env.AI_DAILY_LIMIT ?? 100),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
});
const shutdown = async () => { await app.close(); process.exit(0); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  const host = process.env.HOST ?? (process.env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1');
  await app.listen({ port: Number(process.env.PORT ?? 3001), host });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
