import { buildApp } from './app.js';

const app = await buildApp({ logger: true, serveWeb: true });
const shutdown = async () => { await app.close(); process.exit(0); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
