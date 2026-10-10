import { MAX_SPEECH_CHARACTERS } from '../shared/speech.js';

export interface SpeechConfig { apiKey: string; voiceId: string }
export class SpeechError extends Error {
  constructor(message: string, public readonly statusCode = 503) { super(message); }
}
export function readSpeechConfig(env: NodeJS.ProcessEnv): SpeechConfig | undefined {
  const provider = env.TTS_PROVIDER?.trim() || 'browser';
  if (provider === 'browser') return undefined;
  if (provider !== 'elevenlabs') throw new Error('TTS_PROVIDER deve ser browser ou elevenlabs.');
  if (!env.JARVIS_PASSWORD) throw new Error('Ative JARVIS_PASSWORD antes de habilitar a voz por IA.');
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  const voiceId = env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey) throw new Error('Configure ELEVENLABS_API_KEY no backend.');
  if (!voiceId || !/^[a-zA-Z0-9]{1,100}$/.test(voiceId)) throw new Error('Configure ELEVENLABS_VOICE_ID com o identificador da voz.');
  return { apiKey, voiceId };
}

async function bytes(response: Response, limit: number) {
  if (!response.body) throw new SpeechError('O serviço de voz retornou áudio vazio.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new SpeechError('A resposta do serviço de voz excedeu o limite.');
      chunks.push(part.value);
    }
    if (!size) throw new SpeechError('O serviço de voz retornou áudio vazio.');
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

export class SpeechProvider {
  private active = false;
  constructor(private config: SpeechConfig, private transport: typeof fetch = fetch, private timeoutMs = 20_000) {}
  async synthesize(text: string, signal?: AbortSignal) {
    if (!text.trim() || text.length > MAX_SPEECH_CHARACTERS) throw new SpeechError('Texto inválido para leitura.', 400);
    if (signal?.aborted) throw new SpeechError('Leitura cancelada.', 499);
    // Serialize quota checks and generation, including across phone/computer requests.
    if (this.active) throw new SpeechError('Há uma voz sendo preparada. Aguarde e tente novamente.', 429);
    this.active = true;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.timeoutMs);
    const headers = { 'xi-api-key': this.config.apiKey, 'Content-Type': 'application/json' };
    try {
      const subscription = await this.transport('https://api.elevenlabs.io/v1/user/subscription', {
        headers, signal: controller.signal, redirect: 'error',
      });
      await this.ensureOK(subscription, 'account');
      let account: { tier?: string; character_count?: number; character_limit?: number };
      try { account = JSON.parse((await bytes(subscription, 65_536)).toString('utf8')) as typeof account; }
      catch (error) { if (error instanceof SpeechError) throw error; throw new SpeechError('Não foi possível verificar o plano do serviço de voz.'); }
      if (!account || account.tier !== 'free') throw new SpeechError('A voz por IA está restrita ao plano Free do ElevenLabs. Use a voz do aparelho.');
      if (!Number.isSafeInteger(account.character_count) || !Number.isSafeInteger(account.character_limit)
        || account.character_count! < 0 || account.character_limit! < 0) throw new SpeechError('Não foi possível verificar a cota do serviço de voz.');
      if (account.character_count! + text.length > account.character_limit!) throw new SpeechError('A cota gratuita de voz foi atingida. Use a voz do aparelho.', 429);
      if (controller.signal.aborted) throw new SpeechError('Leitura cancelada.', 499);
      const response = await this.transport(`https://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}?output_format=mp3_44100_128`, {
        method: 'POST', redirect: 'error', signal: controller.signal, headers: { ...headers, Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: {
          stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true,
        } }),
      });
      await this.ensureOK(response, 'speech');
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('audio/mpeg')) {
        await response.body?.cancel();
        throw new SpeechError('O serviço de voz retornou um formato inválido.');
      }
      return await bytes(response, 4_000_000);
    } catch (error) {
      if (signal?.aborted) throw new SpeechError('Leitura cancelada.', 499);
      if (error instanceof SpeechError) throw error;
      throw new SpeechError(controller.signal.aborted ? 'O serviço de voz demorou para responder.' : 'Não foi possível conectar ao serviço de voz.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.active = false; }
  }
  private async ensureOK(response: Response, operation: 'account' | 'speech') {
    if (response.ok) return;
    let code = '';
    // Interpret known machine codes only; never echo external messages, headers or secrets.
    try {
      const data: unknown = JSON.parse((await bytes(response, 16_384)).toString('utf8'));
      if (data && typeof data === 'object' && 'detail' in data && data.detail && typeof data.detail === 'object'
        && 'status' in data.detail && typeof data.detail.status === 'string') code = data.detail.status;
    } catch { /* Unknown/malformed errors use the safe HTTP-status message below. */ }
    if (code === 'detected_unusual_activity') throw new SpeechError('O ElevenLabs bloqueou o uso gratuito nesta conexão por atividade incomum. Confira o aviso na sua conta ElevenLabs.');
    if (['paid_plan_required', 'payment_required', 'free_users_not_allowed'].includes(code)) throw new SpeechError('O ElevenLabs exige um plano pago para esta voz ou recurso. Escolha uma voz disponível para uso pela API no plano Free.');
    if (code === 'quota_exceeded') throw new SpeechError('A cota da conta ou da chave ElevenLabs foi atingida. Confira o limite de créditos.', 429);
    if (code === 'invalid_api_key') throw new SpeechError('O ElevenLabs recusou a chave. Confira ELEVENLABS_API_KEY no Render.');
    if (code === 'voice_not_found') throw new SpeechError('A voz não está disponível nesta conta. Confira ELEVENLABS_VOICE_ID no Render.');
    if (code === 'missing_permissions') throw new SpeechError(operation === 'account'
      ? 'A chave ElevenLabs precisa de User → Read para verificar o plano e a cota.'
      : 'A chave ElevenLabs precisa de Text to Speech → Access para gerar áudio.');
    if (response.status === 429) throw new SpeechError('O serviço de voz atingiu um limite. Use a voz do aparelho.', 429);
    if ([401, 403].includes(response.status)) throw new SpeechError(operation === 'account'
      ? 'O ElevenLabs recusou a consulta do plano. Confira a chave no Render e a permissão User → Read.'
      : 'O ElevenLabs recusou a geração. Confira a permissão Text to Speech → Access e a disponibilidade da voz no plano Free.');
    if ([400, 404, 422].includes(response.status)) throw new SpeechError('Confira se a voz escolhida está disponível na sua conta ElevenLabs.');
    throw new SpeechError('O serviço de voz está indisponível. Use a voz do aparelho.');
  }
}
