import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PersonalError, PersonalStore, sessionHash } from './store.js';

export interface PersonalConfig { password: string; secure: boolean; supabase?: { url: string; key: string } }
export function readPersonalConfig(env: NodeJS.ProcessEnv): PersonalConfig | undefined {
  if (!env.JARVIS_PASSWORD && !env.SUPABASE_URL && !env.SUPABASE_SECRET_KEY) return;
  if (!env.JARVIS_PASSWORD || env.JARVIS_PASSWORD.length < 12 || env.JARVIS_PASSWORD.length > 200) throw new Error('Defina JARVIS_PASSWORD no backend com 12 a 200 caracteres.');
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if ((env.SUPABASE_URL || env.SUPABASE_SECRET_KEY) && (!url || !key)) {
    const missing = [!url ? 'SUPABASE_URL' : '', !key ? 'SUPABASE_SECRET_KEY' : ''].filter(Boolean).join(' e ');
    throw new Error(`${missing}: variável ausente ou vazia. No Render, abra Environment, preencha esse nome exato e salve com novo deploy. SUPABASE_URL e SUPABASE_SECRET_KEY devem ser configuradas juntas.`);
  }
  return { password: env.JARVIS_PASSWORD, secure: env.RENDER === 'true' || env.NODE_ENV === 'production',
    ...(url && key ? { supabase: { url, key } } : {}) };
}
const derive = promisify(scrypt);
const lifetime = 7 * 24 * 60 * 60 * 1000;
export class PersonalAuth {
  private verifier: Buffer;
  private version: string;
  private attempts: number[] = [];
  private active = 0;
  constructor(private config: PersonalConfig, private store: PersonalStore) {
    if (config.password.length < 12 || config.password.length > 200) throw new Error('A senha pessoal precisa ter 12 a 200 caracteres.');
    this.verifier = scryptSync(config.password, 'jarvis-personal-password-v1', 32);
    this.version = createHmac('sha256', this.verifier).update('session-version').digest('hex');
  }
  token(request: FastifyRequest) {
    const match = request.headers.cookie?.match(/(?:^|;\s*)jarvis_session=([a-f0-9]{64})(?:;|$)/);
    return match?.[1];
  }
  async authenticated(request: FastifyRequest) { const token = this.token(request); return token ? this.store.validSession(sessionHash(token), this.version) : false; }
  async obsidianAuthenticated(request: FastifyRequest) {
    const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    return token ? this.store.validObsidianDevice(sessionHash(token), this.version) : false;
  }
  async createObsidianDevice(name: string) {
    const token = randomBytes(32).toString('hex');
    const device = await this.store.createObsidianDevice(name.trim(), sessionHash(token), this.version);
    return { device, token };
  }
  listObsidianDevices() { return this.store.listObsidianDevices(this.version); }
  async login(password: string, reply: FastifyReply) {
    const now = Date.now(); this.attempts = this.attempts.filter(time => now - time < 60_000);
    if (this.active >= 2 || this.attempts.length >= 10) throw new PersonalError('Muitas tentativas de acesso. Aguarde um minuto.', 429);
    this.attempts.push(now); this.active++;
    try {
      const input = await derive(password, 'jarvis-personal-password-v1', 32) as Buffer;
      if (!timingSafeEqual(this.verifier, input)) return false;
      const token = randomBytes(32).toString('hex');
      await this.store.addSession(sessionHash(token), this.version, Date.now() + lifetime);
      this.cookie(reply, token, lifetime / 1000);
      return true;
    } finally { this.active--; }
  }
  async logout(request: FastifyRequest, reply: FastifyReply) {
    const token = this.token(request); if (token) await this.store.removeSession(sessionHash(token));
    this.cookie(reply, '', 0);
  }
  private cookie(reply: FastifyReply, token: string, maxAge: number) {
    reply.header('Set-Cookie', `jarvis_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.config.secure ? '; Secure' : ''}`);
  }
}
