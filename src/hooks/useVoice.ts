import { useCallback, useEffect, useRef, useState } from 'react';
import { requestSpeech, SpeechRequestError } from '../lib/speech';
import { speechText, VOICE_ID_PATTERN, type SpeechProfile } from '../../shared/speech';

interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } };
}
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type VoiceWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const getRecognition = () => (window as VoiceWindow).SpeechRecognition ?? (window as VoiceWindow).webkitSpeechRecognition;
interface InputOptions {
  captureAudio?: boolean;
  onComplete?: (text: string) => void;
  onFailure?: () => void;
}

export function useVoiceInput(onTranscript: (text: string) => void, options: InputOptions = {}) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording'>('idle');
  const [error, setError] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [interim, setInterim] = useState('');
  const [durationMs, setDurationMs] = useState<number>();
  const started = useRef(0);
  const lastDuration = useRef<number | undefined>(undefined);
  const phaseRef = useRef(phase);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const url = useRef('');
  const transcript = useRef('');
  const failed = useRef(false);
  const callback = useRef(onTranscript);
  const settings = useRef(options);
  callback.current = onTranscript;
  settings.current = options;
  const canRecord = window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined';
  const canRecognize = window.isSecureContext && !!getRecognition();
  const changePhase = (value: typeof phase) => { phaseRef.current = value; setPhase(value); };
  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    phaseRef.current = 'idle';
    setPhase('idle');
    setInterim('');
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    const speech = recognition.current;
    recognition.current = null;
    speech?.abort();
    release();
  }, [release]);
  const stop = useCallback(() => {
    const speech = recognition.current;
    release();
    speech?.stop();
  }, [release]);
  const fail = (message: string) => {
    failed.current = true;
    setError(message);
    settings.current.onFailure?.();
  };
  const start = async () => {
    const captureAudio = settings.current.captureAudio !== false;
    if (phaseRef.current !== 'idle' || !(captureAudio ? canRecord : canRecognize)) return;
    changePhase('requesting');
    started.current = performance.now(); lastDuration.current = undefined; setDurationMs(undefined);
    setError('');
    setInterim('');
    transcript.current = '';
    failed.current = false;
    const token = ++generation.current;
    const sessionSettings = { ...settings.current };
    try {
      // SpeechRecognition handles its own permission in voice mode. Avoid opening two
      // microphone streams, which can fail on phones. Chat keeps optional MediaRecorder capture.
      if (captureAudio) {
        const input = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (token !== generation.current) { input.getTracks().forEach(track => track.stop()); return; }
        stream.current = input;
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = '';
        setAudioUrl('');
        const chunks: BlobPart[] = [];
        const capture = new MediaRecorder(input);
        recorder.current = capture;
        capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        capture.onstop = () => {
          if (token !== generation.current || !chunks.length) return;
          url.current = URL.createObjectURL(new Blob(chunks, { type: capture.mimeType }));
          setAudioUrl(url.current);
        };
        capture.onerror = () => { fail('A gravação falhou. Você pode continuar digitando.'); cancel(); };
        capture.start();
        changePhase('recording');
      }
      const SpeechRecognition = getRecognition();
      if (SpeechRecognition) {
        const speech = new SpeechRecognition();
        recognition.current = speech;
        speech.lang = 'pt-BR';
        speech.continuous = false;
        speech.interimResults = true;
        // An ended recognition can still deliver queued callbacks. Keep its token
        // for MediaRecorder finalization, but accept events only from the live instance.
        const active = () => token === generation.current && recognition.current === speech;
        speech.onstart = () => { if (active() && phaseRef.current !== 'idle') changePhase('recording'); };
        speech.onresult = event => {
          if (!active()) return;
          let final = '', pending = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) final += event.results[i][0].transcript + ' ';
            else pending += event.results[i][0].transcript;
          }
          setInterim(pending || final.trim());
          if (final.trim()) {
            transcript.current = `${transcript.current} ${final.trim()}`.trim();
            callback.current(final.trim());
          }
        };
        speech.onerror = event => {
          if (!active() || event.error === 'aborted') return;
          const messages: Record<string, string> = {
            'not-allowed': 'Permissão do microfone negada. Confira as permissões do navegador ou digite.',
            'service-not-allowed': 'Este navegador bloqueou o serviço de voz. Continue digitando.',
            'network': 'O serviço de reconhecimento do navegador não está disponível. Continue digitando.',
            'no-speech': 'Nenhuma fala detectada. Toque no microfone para tentar novamente.',
            'audio-capture': 'Nenhum microfone disponível para reconhecer a fala. Continue digitando.',
          };
          fail(messages[event.error] ?? 'O reconhecimento falhou. Você pode continuar digitando.');
          cancel();
        };
        speech.onend = () => {
          if (!active()) return;
          recognition.current = null;
          release();
          const text = transcript.current.trim();
          lastDuration.current = Math.round(performance.now() - started.current);
          setDurationMs(lastDuration.current);
          if (!failed.current && text) sessionSettings.onComplete?.(text);
          else if (!text && !failed.current) fail('Nenhuma fala detectada. Toque no microfone para tentar novamente.');
        };
        try { speech.start(); }
        catch {
          recognition.current = null;
          fail('Reconhecimento indisponível. Continue digitando ou tente ativar o microfone novamente.');
          if (!captureAudio) release();
        }
      }
      if (phaseRef.current !== 'idle') timer.current = setTimeout(() => {
        fail('O microfone foi pausado após 60 segundos. Toque para começar novamente.');
        cancel();
      }, 60_000);
    } catch (cause) {
      if (token !== generation.current) return;
      cancel();
      const name = cause instanceof DOMException ? cause.name : '';
      fail(name === 'NotAllowedError' ? 'Permissão do microfone negada. Você pode continuar digitando.' : name === 'NotFoundError' ? 'Nenhum microfone encontrado. Você pode continuar digitando.' : 'Não foi possível iniciar o microfone. Você pode continuar digitando.');
    }
  };
  const clearAudio = useCallback(() => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = '';
    setAudioUrl('');
  }, []);
  useEffect(() => () => {
    generation.current++;
    recognition.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    if (url.current) URL.revokeObjectURL(url.current);
  }, []);
  return { phase, error, audioUrl, interim, durationMs, getDurationMs: () => lastDuration.current, canRecord, canRecognize, start, stop, cancel, cancelRequest: cancel, clearAudio };
}

export type SpeechOutcome = 'ended' | 'canceled' | 'error' | 'unavailable';
function useNativeSpeechOutput(profile: SpeechProfile) {
  const supported = typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState(() => {
    try { return localStorage.getItem('jarvis.speech-voice.v1') ?? ''; } catch { return ''; }
  });
  const finish = useRef<((outcome: SpeechOutcome) => void) | null>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    finish.current?.('canceled');
    finish.current = null;
    currentUtterance.current = null;
    if (supported) window.speechSynthesis.cancel();
    setError('');
    setSpeaking(false);
    setBusy(false);
  }, [supported]);
  const speak = useCallback((text: string, onPlaying?: () => void): Promise<SpeechOutcome> => {
    if (!supported) return Promise.resolve('unavailable');
    stop();
    const token = ++generation.current;
    setError('');
    setBusy(true);
    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(speechText(text));
      currentUtterance.current = utterance;
      utterance.lang = profile === 'british' ? 'en-GB' : 'pt-BR';
      const available = window.speechSynthesis.getVoices();
      const chosen = available.find(voice => voice.voiceURI === voiceUri)
        ?? (profile === 'british' ? available.find(voice => voice.lang.toLowerCase() === 'en-gb') : undefined)
        ?? available.find(voice => voice.lang.toLowerCase() === 'pt-br')
        ?? available.find(voice => voice.lang.toLowerCase().startsWith('pt'));
      if (chosen) { utterance.voice = chosen; utterance.lang = chosen.lang; }
      utterance.rate = profile !== 'natural' ? 0.94 : 1;
      let timeout: ReturnType<typeof setTimeout>;
      const complete = (outcome: SpeechOutcome) => {
        clearTimeout(timeout);
        if (token === generation.current) {
          setSpeaking(false);
          setBusy(false);
          finish.current = null;
          currentUtterance.current = null;
        }
        resolve(outcome);
      };
      finish.current = complete;
      const fail = () => {
        if (token !== generation.current) return;
        complete('error');
        window.speechSynthesis.cancel();
        setError('A voz não foi reproduzida. Toque em “Ouvir resposta” ou continue pelo texto.');
      };
      timeout = setTimeout(fail, 8000);
      utterance.onstart = () => {
        if (token !== generation.current) return;
        clearTimeout(timeout);
        timeout = setTimeout(fail, 360_000);
        setSpeaking(true);
        onPlaying?.();
      };
      utterance.onend = () => { if (token === generation.current) complete('ended'); };
      utterance.onerror = event => {
        if (token !== generation.current) return;
        if (event.error === 'interrupted' || event.error === 'canceled') complete('canceled');
        else fail();
      };
      try { window.speechSynthesis.speak(utterance); } catch { fail(); }
    });
  }, [supported, stop, voiceUri, profile]);
  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => { window.speechSynthesis.removeEventListener?.('voiceschanged', load); stop(); };
  }, [supported, stop]);
  const chooseVoice = (uri: string) => {
    setVoiceUri(uri);
    try { localStorage.setItem('jarvis.speech-voice.v1', uri); } catch { /* Preference remains valid for this session. */ }
  };
  return { supported, speaking, busy, error, voices, voiceUri, chooseVoice, speak, stop };
}

type SpeechEngine = 'auto' | 'browser' | 'elevenlabs';
export function useSpeechOutput(cloudAvailable = false) {
  const [profile, setProfile] = useState<SpeechProfile>(() => {
    try { const saved = localStorage.getItem('jarvis.speech-profile.v2'); return saved === 'natural' || saved === 'british' ? saved : 'jarvis-br'; } catch { return 'jarvis-br'; }
  });
  const [cloudVoiceId, setCloudVoiceId] = useState(() => {
    try { const id = localStorage.getItem('jarvis.cloud-voice.v1') ?? ''; return VOICE_ID_PATTERN.test(id) ? id : ''; } catch { return ''; }
  });
  const native = useNativeSpeechOutput(profile);
  const [engine, setEngine] = useState<SpeechEngine>(() => {
    try { const saved = localStorage.getItem('jarvis.speech-engine.v1'); return saved === 'browser' || saved === 'elevenlabs' ? saved : 'auto'; } catch { return 'auto'; }
  });
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [timings, setTimings] = useState<{ prepareMs?: number; firstAudioMs: number; engine: string }>();
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const preparationRequests = useRef(new Set<AbortController>());
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef('');
  const finish = useRef<((outcome: SpeechOutcome) => void) | null>(null);
  // Retain up to two clips in memory for explicit replay, including segmented speech.
  const cached = useRef(new Map<string, Blob>());
  const clipKey = useCallback((text: string) => JSON.stringify([cloudVoiceId, profile, text]), [cloudVoiceId, profile]);
  const cache = useCallback((text: string, blob: Blob) => {
    cached.current.delete(text); cached.current.set(text, blob);
    while (cached.current.size > 2) cached.current.delete(cached.current.keys().next().value!);
  }, []);
  const prepare = useCallback(async (text: string, signal: AbortSignal) => {
    if (!cloudAvailable || engine === 'browser') return;
    const prose = speechText(text);
    const key = clipKey(prose);
    if (!prose || cached.current.has(key)) return;
    const controller = new AbortController();
    preparationRequests.current.add(controller);
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const timer = setTimeout(cancel, 25_000);
    try {
      const blob = await requestSpeech(prose, controller.signal, { profile, ...(cloudVoiceId ? { voiceId: cloudVoiceId } : {}) });
      if (!controller.signal.aborted) cache(key, blob);
    } catch (cause) {
      if (controller.signal.aborted && !signal.aborted) throw new SpeechRequestError('O serviço de voz demorou para preparar a segunda parte.');
      throw cause;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); preparationRequests.current.delete(controller); }
  }, [cloudAvailable, engine, cache, clipKey, profile, cloudVoiceId]);
  const stop = useCallback(() => {
    generation.current++;
    finish.current?.('canceled');
    finish.current = null;
    request.current?.abort(); request.current = null;
    preparationRequests.current.forEach(controller => controller.abort()); preparationRequests.current.clear();
    if (audio.current) {
      audio.current.onplaying = null; audio.current.onended = null; audio.current.onerror = null;
      audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load(); audio.current = null;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
    native.stop(); setBusy(false); setSpeaking(false);
  }, [native.stop]);
  const speak = useCallback(async (text: string, selectedEngine: SpeechEngine = engine, onPlaying?: (via: 'browser' | 'elevenlabs') => void): Promise<SpeechOutcome> => {
    stop(); setError(''); setNotice('');
    setTimings(undefined);
    const started = performance.now();
    const nativePlaying = () => { setTimings({ firstAudioMs: Math.round(performance.now() - started), engine: 'aparelho' }); onPlaying?.('browser'); };
    if (selectedEngine === 'elevenlabs' && !cloudAvailable) {
      setError('O ElevenLabs não está configurado neste servidor. Confira as variáveis no Render e atualize a página.');
      return 'unavailable';
    }
    if (!cloudAvailable || selectedEngine === 'browser') return native.speak(text, nativePlaying);
    const prose = speechText(text);
    const key = clipKey(prose);
    if (!prose) return selectedEngine === 'elevenlabs' ? 'unavailable' : native.speak(text, nativePlaying);
    const token = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    setBusy(true);
    let providerFailed = false;
    const outcome = await new Promise<SpeechOutcome>(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const complete = (value: SpeechOutcome) => {
        clearTimeout(timer);
        if (token === generation.current) {
          finish.current = null; request.current = null; setBusy(false); setSpeaking(false);
          if (audio.current) { audio.current.onplaying = null; audio.current.onended = null; audio.current.onerror = null; audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load(); audio.current = null; }
          if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
          objectUrl.current = '';
        }
        resolve(value);
      };
      finish.current = complete;
      const playbackFailed = (cause?: unknown) => {
        if (token !== generation.current) return;
        setError(cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'O navegador bloqueou o áudio automático. Toque em “Ouvir resposta” ou “Testar voz” para reproduzir o áudio já preparado, sem gerar novamente.'
          : 'Não foi possível reproduzir o áudio. Toque em “Ouvir resposta” ou “Testar voz” para tentar novamente. Confira também o volume e se a aba está silenciada.');
        complete('error');
      };
      const run = async () => {
        let blob: Blob;
        try {
          blob = cached.current.get(key) ?? await requestSpeech(prose, controller.signal, { profile, ...(cloudVoiceId ? { voiceId: cloudVoiceId } : {}) });
        } catch (cause) {
          if (token !== generation.current) return;
          if (cause instanceof SpeechRequestError && cause.status === 401) { complete('canceled'); return; }
          providerFailed = true;
          const message = cause instanceof SpeechRequestError ? cause.message : 'Não foi possível conectar à voz por IA.';
          if (selectedEngine === 'elevenlabs') setError(message);
          else setNotice(`${message} ${native.supported ? 'Usando a voz do aparelho.' : 'Continue pelo texto.'}`);
          complete('error'); return;
        }
        if (token !== generation.current) return;
        cache(key, blob);
        const prepareMs = Math.round(performance.now() - started);
        clearTimeout(timer);
        objectUrl.current = URL.createObjectURL(blob);
        const player = new Audio(objectUrl.current); audio.current = player;
        let notified = false;
        player.onplaying = () => {
          if (token !== generation.current) return;
          setNotice('Voz reproduzida: ElevenLabs.');
          setSpeaking(true); clearTimeout(timer); timer = setTimeout(playbackFailed, 360_000);
          setTimings({ prepareMs, firstAudioMs: Math.round(performance.now() - started), engine: 'ElevenLabs' });
          if (!notified) { notified = true; onPlaying?.('elevenlabs'); }
        };
        player.onended = () => { if (token === generation.current) complete('ended'); };
        player.onerror = playbackFailed;
        timer = setTimeout(playbackFailed, 8000);
        try { await player.play(); } catch (cause) { playbackFailed(cause); }
      };
      timer = setTimeout(() => controller.abort(), 25_000);
      void run().catch(() => playbackFailed());
    });
    if (token !== generation.current) return 'canceled';
    return providerFailed && selectedEngine === 'auto' && native.supported ? native.speak(text, nativePlaying) : outcome;
  }, [cloudAvailable, engine, native.speak, native.supported, stop, cache, clipKey, profile, cloudVoiceId]);
  const chooseEngine = (value: SpeechEngine) => {
    stop(); setEngine(value); setError(''); setNotice('');
    try { localStorage.setItem('jarvis.speech-engine.v1', value); } catch { /* Session preference still works. */ }
  };
  const chooseProfile = (value: SpeechProfile) => {
    stop(); cached.current.clear(); setProfile(value); setError(''); setNotice('');
    try { localStorage.setItem('jarvis.speech-profile.v2', value); } catch { /* Session preference still works. */ }
  };
  const chooseCloudVoice = (value: string) => {
    const id = value.trim();
    if (id && !VOICE_ID_PATTERN.test(id)) { setError('Cole somente o Voice ID, sem endereço ou chave API.'); return false; }
    stop(); cached.current.clear(); setCloudVoiceId(id); setError(''); setNotice('');
    try { localStorage.setItem('jarvis.cloud-voice.v1', id); } catch { /* Session preference still works. */ }
    return true;
  };
  useEffect(() => () => { stop(); cached.current.clear(); }, [stop]);
  return { ...native, supported: native.supported || cloudAvailable, busy: busy || native.busy,
    speaking: speaking || native.speaking, error: error || native.error, notice, timings, engine, chooseEngine, cloudAvailable,
    nativeAvailable: native.supported, profile, chooseProfile, cloudVoiceId, chooseCloudVoice, speak, prepare, stop };
}

export function useSpeechInterrupt(enabled: boolean, spokenText: string, onInterrupt: () => void) {
  const [error, setError] = useState('');
  const callback = useRef(onInterrupt); callback.current = onInterrupt;
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
  useEffect(() => {
    if (!enabled || document.hidden) return;
    const Constructor = getRecognition();
    if (!Constructor) return;
    let active = true; let instance: Recognition | undefined; let timer: ReturnType<typeof setTimeout>; let restarts = 0;
    setError('');
    const start = () => {
      if (!active || document.hidden) return;
      const recognition = new Constructor(); instance = recognition;
      recognition.lang = 'pt-BR'; recognition.continuous = true; recognition.interimResults = false;
      recognition.onresult = event => {
        if (!active || instance !== recognition) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (!event.results[i].isFinal) continue;
          const text = normalize(event.results[i][0].transcript);
          if (/^jarvis (pare|parar|pausa|pause|silencio)$/.test(text) && !normalize(spokenText).includes(text)) {
            active = false; recognition.abort(); callback.current(); return;
          }
        }
      };
      recognition.onerror = event => {
        if (!active || event.error === 'aborted') return;
        active = false; recognition.abort();
        setError('Interrupção por voz indisponível nesta sessão. Use o botão central.');
      };
      recognition.onend = () => {
        if (!active || instance !== recognition) return;
        instance = undefined;
        if (++restarts <= 2) timer = setTimeout(start, 500);
        else { active = false; setError('A escuta para interromper terminou. Use o botão central.'); }
      };
      try { recognition.start(); } catch { active = false; setError('Este navegador não permite ouvir durante a resposta. Use o botão central.'); }
    };
    start();
    return () => { active = false; clearTimeout(timer); instance?.abort(); };
  }, [enabled, spokenText]);
  return error;
}
