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
      await this.ensureOK(subscription);
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
      await this.ensureOK(response);
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
  private async ensureOK(response: Response) {
    if (response.ok) return;
    await response.body?.cancel();
    if (response.status === 429) throw new SpeechError('O serviço de voz atingiu um limite. Use a voz do aparelho.', 429);
    if ([401, 403].includes(response.status)) throw new SpeechError('Confira a chave e as permissões de voz e leitura da conta no ElevenLabs.');
    if ([400, 404, 422].includes(response.status)) throw new SpeechError('Confira se a voz escolhida está disponível na sua conta ElevenLabs.');
    throw new SpeechError('O serviço de voz está indisponível. Use a voz do aparelho.');
  }
}
