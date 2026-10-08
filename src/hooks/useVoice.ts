import { useCallback, useEffect, useRef, useState } from 'react';

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
        speech.onstart = () => { if (token === generation.current) changePhase('recording'); };
        speech.onresult = event => {
          if (token !== generation.current) return;
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
          if (token !== generation.current || event.error === 'aborted') return;
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
          if (token !== generation.current) return;
          recognition.current = null;
          release();
          const text = transcript.current.trim();
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
  return { phase, error, audioUrl, interim, canRecord, canRecognize, start, stop, cancel, cancelRequest: cancel, clearAudio };
}

export type SpeechOutcome = 'ended' | 'canceled' | 'error' | 'unavailable';
export function useSpeechOutput() {
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
    setSpeaking(false);
    setBusy(false);
  }, [supported]);
  const speak = useCallback((text: string): Promise<SpeechOutcome> => {
    if (!supported) return Promise.resolve('unavailable');
    stop();
    const token = ++generation.current;
    setError('');
    setBusy(true);
    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 4000));
      currentUtterance.current = utterance;
      utterance.lang = 'pt-BR';
      const available = window.speechSynthesis.getVoices();
      const chosen = available.find(voice => voice.voiceURI === voiceUri)
        ?? available.find(voice => voice.lang.toLowerCase() === 'pt-br')
        ?? available.find(voice => voice.lang.toLowerCase().startsWith('pt'));
      if (chosen) { utterance.voice = chosen; utterance.lang = chosen.lang; }
      utterance.rate = 1;
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
      };
      utterance.onend = () => { if (token === generation.current) complete('ended'); };
      utterance.onerror = event => {
        if (token !== generation.current) return;
        if (event.error === 'interrupted' || event.error === 'canceled') complete('canceled');
        else fail();
      };
      try { window.speechSynthesis.speak(utterance); } catch { fail(); }
    });
  }, [supported, stop, voiceUri]);
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
