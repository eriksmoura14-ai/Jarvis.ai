import { useEffect, useRef } from 'react';
import type { ReceptionPreferences } from '../lib/reception';
import { newsDay } from '../lib/reception';

interface Props {
  preferences: ReceptionPreferences; greeting: string; enabled: boolean; busy: boolean;
  onNews: () => Promise<boolean>; onSpeak: () => void; speechSupported: boolean;
  headless?: boolean;
}
export function Reception(props: Props) {
  const attempted = useRef(false);
  const callback = useRef(props.onNews); callback.current = props.onNews;
  const requestNews = () => {
    attempted.current = true;
    try { localStorage.setItem('jarvis.news-day.v1', newsDay(new Date())); } catch { /* Manual requests work without storage. */ }
    void props.onNews();
  };
  useEffect(() => {
    if (!props.enabled || !props.preferences.autoNews || props.busy || attempted.current) return;
    const day = newsDay(new Date());
    try { if (localStorage.getItem('jarvis.news-day.v1') === day) return; } catch { return; }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden || attempted.current) return;
      timer = setTimeout(() => {
        if (document.hidden || attempted.current) return;
        try { if (localStorage.getItem('jarvis.news-day.v1') === day) return; } catch { return; }
        attempted.current = true;
        // Claim before sending, preventing retries every render or focus change.
        try { localStorage.setItem('jarvis.news-day.v1', day); } catch { return; }
        void callback.current();
      }, 1500);
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', schedule); };
  }, [props.enabled, props.preferences.autoNews, props.busy]);
  if (props.headless || !props.preferences.greeting) return null;
  return <section className="reception" aria-label="Recepção pessoal">
    <p>{props.greeting}</p>
    <div><button data-gamepad className="secondary-button" disabled={props.busy || !props.speechSupported} onClick={props.onSpeak}>Ouvir saudação</button>
      <button data-gamepad className="secondary-button" disabled={props.busy || !props.enabled} onClick={requestNews}>Resumo de notícias</button></div>
  </section>;
}

export function ReceptionSettings({ value, onChange }: { value: ReceptionPreferences; onChange: (next: ReceptionPreferences) => void }) {
  return <div className="reception-settings">
    <label className="setting-row"><span><strong>Recepção pessoal ao abrir</strong><small>Usa seu nome e tratamento salvos. Ouça pelo botão da saudação.</small></span><input data-gamepad type="checkbox" checked={value.greeting} onChange={event => onChange({ ...value, greeting: event.target.checked })} /></label>
    <label className="setting-row"><span><strong>Buscar notícias ao abrir</strong><small>Uma vez por dia neste aparelho, com a página visível. Consome busca e cota de IA. Usa o assunto escolhido abaixo.</small></span><input data-gamepad type="checkbox" checked={value.autoNews} onChange={event => onChange({ ...value, autoNews: event.target.checked })} /></label>
    <label className="setting-row"><span><strong>Ler o resumo de notícias</strong><small>O celular pode exigir um toque em “Ouvir resposta”.</small></span><input data-gamepad type="checkbox" checked={value.readNews} onChange={event => onChange({ ...value, readNews: event.target.checked })} /></label>
    <label className="reception-topic">Assunto das notícias<input data-gamepad maxLength={100} value={value.topic} onChange={event => onChange({ ...value, topic: event.target.value })} /></label>
    <p className="privacy-note">Estas escolhas ficam neste aparelho. Notícias vêm de trechos do buscador: confira as fontes e datas; a consulta de hoje não garante que a publicação seja de hoje.</p>
  </div>;
}
