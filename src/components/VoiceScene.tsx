import { useState, type FormEvent, type RefObject } from 'react';
import { CircleHelp, History, Keyboard, MessageSquare, Mic, Send, Settings2, ShieldCheck, Square, Volume2, VolumeX } from 'lucide-react';
import { Core } from './Core';
import { MAX_MESSAGE_LENGTH, type SearchSource, type WebSearchInfo } from '../../shared/contracts';
import { SearchSources } from './SearchSources';
import { SearchToggle } from './SearchToggle';

interface VoiceSceneProps {
  state: 'idle' | 'thinking' | 'listening' | 'speaking';
  phase: 'idle' | 'requesting' | 'recording';
  pending: boolean;
  speechBusy: boolean;
  canListen: boolean;
  speechSupported: boolean;
  sound: boolean;
  continuous: boolean;
  status: string;
  connection: string;
  modelStatus: string;
  searchEnabled: boolean;
  webSearch: boolean;
  sources?: SearchSource[];
  searchInfo?: WebSearchInfo;
  onWebSearch: (value: boolean) => void;
  error: string;
  notice: string;
  transcript: string;
  reply: string;
  draft: string;
  storageError: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDraft: (text: string) => void;
  onSend: () => void;
  onMicrophone: () => void;
  onInterrupt: () => void;
  onSound: () => void;
  onContinuous: (value: boolean) => void;
  onChat: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onReplay: () => void;
}

export function VoiceScene(props: VoiceSceneProps) {
  const [typing, setTyping] = useState(!props.canListen);
  const busy = props.pending || props.speechBusy;
  const active = busy || props.phase !== 'idle';
  const microphoneLabel = props.phase === 'requesting' ? 'Cancelar solicitação do microfone'
    : props.phase === 'recording' ? 'Concluir fala' : busy ? 'Interromper resposta' : 'Falar com JARVIS';
  const submit = (event: FormEvent) => { event.preventDefault(); props.onSend(); };
  return <main id="main" tabIndex={-1} className={`voice-scene scene-${props.state}`}>
    <header className="scene-header">
      <a href="#main" className="scene-brand" aria-label="JARVIS AI"><span className="scene-brand-mark">J<span>.</span></span><span>JARVIS<span className="scene-brand-caption">ASSISTENTE PESSOAL</span></span></a>
      <nav className="scene-navigation" aria-label="Opções do assistente">
        <button data-gamepad className="scene-nav-button" aria-label="Abrir histórico" title="Histórico" onClick={props.onHistory}><History size={19} /><span>Histórico</span></button>
        <button data-gamepad className="scene-nav-button" aria-label="Abrir modo chat" title="Modo chat" onClick={props.onChat}><MessageSquare size={19} /><span>Chat</span></button>
        <button data-gamepad className="scene-nav-button" aria-label="Preferências" title="Preferências" onClick={props.onSettings}><Settings2 size={19} /></button>
      </nav>
    </header>

    <section className="scene-center" aria-label="Assistente por voz">
      <div className="scene-intro"><span className="scene-kicker">PRESENTE. ATENTO. PRONTO.</span><h1>J.A.R.V.I.S.</h1></div>
      <div className="scene-core-stage"><div className="scene-orbit" aria-hidden="true" /><Core state={props.state} /></div>
      <div className="scene-state" role="status" aria-live="polite"><span className={`status-dot ${props.state}`} />{props.phase === 'requesting' ? 'Aguardando permissão' : props.status}</div>
      <p className="scene-prompt">{props.phase === 'recording' ? 'Estou ouvindo. Termine sua frase ou toque para concluir.'
        : props.pending ? 'Só um instante. Estou cuidando do seu pedido.'
        : props.speechBusy ? 'Você pode interromper a resposta quando quiser.'
        : props.notice || (props.canListen ? 'Toque no microfone. Fale comigo.' : 'A voz não está disponível aqui. Podemos conversar por texto.')}</p>

      <div className="scene-response" aria-live="polite" aria-atomic="true">
        {props.transcript && <p className="scene-transcript"><span>VOCÊ</span>{props.transcript}</p>}
        {props.reply && <p className="scene-reply"><span>JARVIS</span>{props.reply}</p>}
        <SearchSources sources={props.sources} info={props.searchInfo} />
        {!props.transcript && !props.reply && <p className="scene-example">Experimente: <span>“Jarvis, que horas são?”</span></p>}
      </div>
      {props.error && <p className="scene-error" role="alert">{props.error}</p>}

      <div className="scene-controls">
        <button data-gamepad className="scene-secondary-control" aria-label={props.sound ? 'Desativar respostas faladas' : 'Ativar respostas faladas'} aria-pressed={props.sound} disabled={!props.speechSupported} onClick={props.onSound} title={props.sound ? 'Desativar voz' : 'Ativar voz'}>{props.sound ? <Volume2 size={21} /> : <VolumeX size={21} />}</button>
        <button data-gamepad className={`scene-microphone ${active ? 'scene-microphone-active' : ''}`} aria-label={microphoneLabel} aria-pressed={props.phase === 'recording'} disabled={!props.canListen && !active} onClick={props.onMicrophone}>{active ? <Square size={24} /> : <Mic size={27} />}</button>
        <button data-gamepad className="scene-secondary-control" aria-label={typing ? 'Recolher digitação' : 'Digitar mensagem'} aria-expanded={typing} aria-controls="scene-typing" onClick={() => { props.onInterrupt(); setTyping(previous => !previous); }} title="Digitar mensagem"><Keyboard size={22} /></button>
      </div>
      <div className="scene-control-caption">{props.phase === 'requesting' ? 'Toque para cancelar' : props.phase === 'recording' ? 'Toque para concluir a fala' : busy ? 'Toque para interromper' : props.canListen ? 'Falar com JARVIS' : 'Digite para conversar'}</div>

      <label className="scene-continuous"><input data-gamepad type="checkbox" checked={props.continuous} disabled={!props.canListen || !props.speechSupported || !props.sound} onChange={event => props.onContinuous(event.target.checked)} /><span>Conversa contínua</span><span className="scene-continuous-detail">Volta a ouvir depois da resposta</span></label>
      {props.reply && props.speechSupported && <button data-gamepad className="scene-replay" aria-label="Ouvir resposta" onClick={props.onReplay}><Volume2 size={14} /> Ouvir resposta</button>}

      {typing && <form id="scene-typing" className="scene-typing" onSubmit={submit}>
        <label htmlFor="message-input">Sua mensagem</label>
        <div className="scene-typing-row"><textarea data-gamepad id="message-input" ref={props.textareaRef} aria-label="Sua mensagem para JARVIS" placeholder="Digite um comando…" maxLength={MAX_MESSAGE_LENGTH} rows={2} value={props.draft} onChange={event => props.onDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); props.onSend(); } }} /><button data-gamepad type="submit" className="send-button" aria-label="Enviar mensagem" disabled={!props.draft.trim() || props.pending || props.phase !== 'idle'}><Send size={18} /></button></div>
      </form>}
      <SearchToggle enabled={props.searchEnabled} checked={props.webSearch} disabled={active} onChange={props.onWebSearch} />
      {props.storageError && <p className="scene-error" role="alert">O histórico pode não ser salvo: o armazenamento está bloqueado ou sem espaço.</p>}
    </section>

    <footer className="scene-footer"><span className="scene-runtime"><span className="scene-runtime-dot" />{props.connection}</span><button data-gamepad aria-label="Comandos" onClick={props.onHelp}><CircleHelp size={15} /> Comandos locais</button><span className="scene-privacy"><ShieldCheck size={13} /> {props.modelStatus}</span></footer>
  </main>;
}
