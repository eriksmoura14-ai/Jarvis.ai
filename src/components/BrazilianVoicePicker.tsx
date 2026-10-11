import { useEffect, useRef, useState } from 'react';
import type { SpeechVoiceCatalog } from '../../shared/speech';
import { listBrazilianVoices, SpeechRequestError } from '../lib/speech';

export function BrazilianVoicePicker({ onChoose }: { onChoose: (id: string) => void }) {
  const [catalog, setCatalog] = useState<SpeechVoiceCatalog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  const search = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 25_000);
    setBusy(true); setCatalog(undefined); setError('');
    try { const result = await listBrazilianVoices(controller.signal); if (request.current === controller) setCatalog(result); }
    catch (cause) {
      if (request.current === controller) setError(controller.signal.aborted ? 'A busca de vozes demorou para responder. Tente novamente.'
        : cause instanceof SpeechRequestError ? cause.message : 'Não foi possível consultar as vozes.');
    } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <div className="voice-selection">
    <button data-gamepad className="secondary-button" disabled={busy} onClick={() => void search()}>{busy ? 'Buscando vozes brasileiras…' : 'Buscar voz JARVIS brasileira'}</button>
    <small>Busca vozes masculinas em português brasileiro que a biblioteca informa permitir no plano Free. Consultar a lista não gera áudio. Se não houver uma chamada JARVIS, apresenta alternativas brasileiras.</small>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {catalog && <div role="region" aria-label="Vozes brasileiras encontradas">
      <p className="support-note">{!catalog.voices.length ? 'Não encontrei vozes brasileiras que a biblioteca informe permitir no plano Free. Você pode usar a voz atual ou a voz do aparelho.'
        : catalog.matchedJarvis ? 'Vozes com JARVIS no nome. O nome não comprova que sejam a dublagem oficial.'
        : 'Não encontrei uma voz JARVIS elegível. Estas são alternativas brasileiras.'}</p>
      {catalog.voices.map(voice => <button key={voice.id} data-gamepad className="secondary-button catalog-voice" onClick={() => onChoose(voice.id)}>Usar {voice.name}</button>)}
      {!!catalog.voices.length && <small>Após escolher, toque em Testar ElevenLabs. Se a API pedir, adicione a voz à sua biblioteca ElevenLabs. O teste verifica plano e cota e pode consumir créditos gratuitos.</small>}
    </div>}
  </div>;
}
