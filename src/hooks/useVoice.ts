import { useCallback, useEffect, useRef, useState } from 'react';

interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type VoiceWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const getRecognition = () => (window as VoiceWindow).SpeechRecognition ?? (window as VoiceWindow).webkitSpeechRecognition;

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording'>('idle');
  const [error, setError] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [interim, setInterim] = useState('');
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const url = useRef('');
  const callback = useRef(onTranscript);
  callback.current = onTranscript;
  const canRecord = window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined';
  const canRecognize = !!getRecognition();
  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    recognition.current?.stop();
    recognition.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    setPhase('idle');
    setInterim('');
  }, []);
  const start = async () => {
    if (!canRecord || phase !== 'idle') return;
    setError('');
    setPhase('requesting');
    const token = ++generation.current;
    try {
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
      capture.onerror = () => { setError('A gravação falhou. Você pode continuar digitando.'); stop(); };
      capture.start();
      setPhase('recording');
      const SpeechRecognition = getRecognition();
      if (SpeechRecognition) {
        const speech = new SpeechRecognition();
        recognition.current = speech;
        speech.lang = 'pt-BR';
        speech.continuous = false;
        speech.interimResults = true;
        speech.onresult = event => {
          if (token !== generation.current) return;
          let final = '', pending = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) final += event.results[i][0].transcript;
            else pending += event.results[i][0].transcript;
          }
          setInterim(pending);
          if (final.trim()) callback.current(final.trim());
        };
        speech.onerror = event => {
          if (token !== generation.current) return;
          const messages: Record<string, string> = {
            'not-allowed': 'O reconhecimento foi bloqueado. Confira as permissões do navegador.',
            'network': 'O serviço de reconhecimento do navegador não está disponível. Continue digitando.',
            'no-speech': 'Nenhuma fala detectada. Tente novamente ou digite sua mensagem.',
            'audio-capture': 'Não foi possível usar o microfone para reconhecer a fala.',
          };
          if (event.error !== 'aborted') setError(messages[event.error] ?? 'O reconhecimento falhou. Você pode continuar digitando.');
        };
        speech.onend = () => { if (token === generation.current) { recognition.current = null; stop(); } };
        try { speech.start(); }
        catch { recognition.current = null; setError('Reconhecimento indisponível. O áudio será gravado apenas para reprodução local; digite seu pedido.'); }
      }
      timer.current = setTimeout(stop, 60_000);
    } catch (cause) {
      if (token !== generation.current) return;
      stop();
      const name = cause instanceof DOMException ? cause.name : '';
      setError(name === 'NotAllowedError' ? 'Permissão do microfone negada. Você pode continuar digitando.' : name === 'NotFoundError' ? 'Nenhum microfone encontrado. Você pode continuar digitando.' : 'Não foi possível iniciar o microfone. Você pode continuar digitando.');
    }
  };
  const clearAudio = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = '';
    setAudioUrl('');
  };
  const cancelRequest = () => { generation.current++; stop(); };
  useEffect(() => () => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    recognition.current?.abort();
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    if (url.current) URL.revokeObjectURL(url.current);
  }, []);
  return { phase, error, audioUrl, interim, canRecord, canRecognize, start, stop, cancelRequest, clearAudio };
}

export function useSpeechOutput() {
  const supported = typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const stop = useCallback(() => { generation.current++; if (supported) window.speechSynthesis.cancel(); setSpeaking(false); }, [supported]);
  const speak = useCallback((text: string) => {
    if (!supported) return;
    const token = ++generation.current;
    window.speechSynthesis.cancel();
    setError('');
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 4000));
    utterance.lang = 'pt-BR';
    const portuguese = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase() === 'pt-br');
    if (portuguese) utterance.voice = portuguese;
    utterance.rate = 1;
    utterance.onstart = () => { if (token === generation.current) setSpeaking(true); };
    utterance.onend = () => { if (token === generation.current) setSpeaking(false); };
    utterance.onerror = event => {
      if (token !== generation.current) return;
      setSpeaking(false);
      if (event.error !== 'interrupted' && event.error !== 'canceled') setError('A reprodução de voz falhou. A resposta continua disponível em texto.');
    };
    window.speechSynthesis.speak(utterance);
  }, [supported]);
  useEffect(() => stop, [stop]);
  return { supported, speaking, error, speak, stop };
}
