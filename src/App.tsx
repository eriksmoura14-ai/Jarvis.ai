import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowDown, ArrowRight, AudioLines, Check, ChevronRight, CircleHelp, Clock3, Cpu, Gamepad2, Keyboard, MessageSquare, Mic, NotebookPen, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2, Volume2, VolumeX, WifiOff, X } from 'lucide-react';
import { Core } from './components/Core';
import { VoiceScene } from './components/VoiceScene';
import { PersonalMemory } from './components/PersonalMemory';
import { SpeechSettings } from './components/SpeechSettings';
import { personalRequest, personalSnapshot } from './lib/personal';
import type { PersonalSnapshot } from '../shared/contracts';
import { AIConnection } from './components/AIConnection';
import { SearchSources } from './components/SearchSources';
import { SearchToggle } from './components/SearchToggle';
import { Dialog } from './components/Dialog';
import { useGamepad } from './hooks/useGamepad';
import { useSpeechOutput, useVoiceInput } from './hooks/useVoice';
import { BROWSER_MODE, checkHealth, sendMessage } from './lib/api';
import { HISTORY_KEY, MAX_HISTORY, loadHistory, loadSession, loadVoicePreference, loadView, makeId } from './lib/storage';
import { MAX_MESSAGE_LENGTH, type Message } from '../shared/contracts';
import type { HealthResponse } from '../shared/contracts';
import { conversationContext } from '../shared/context';
import { loadBackend } from './lib/backend';

const welcome = (): Message => ({ id: 'welcome', role: 'assistant', content: 'Olá, sou o JARVIS. Seu espaço para pensar, organizar e resolver. Experimente um comando abaixo ou digite “ajuda” para começar.', createdAt: new Date().toISOString() });
const commands = [
  { icon: Clock3, title: 'Que horas são?', command: 'Que horas são?', detail: 'Horário no seu fuso' },
  { icon: NotebookPen, title: 'Guardar uma nota', command: 'anotar ', detail: 'Suas ideias, organizadas' },
  { icon: Cpu, title: 'Fazer um cálculo', command: 'calcular ', detail: 'Números sem complicação' },
];
type Modal = 'help' | 'settings' | 'clear' | 'history' | 'memory' | null;

export default function App({ personal, onLock }: { personal?: PersonalSnapshot; onLock?: () => void } = {}) {
  const [personalData, setPersonalData] = useState(personal);
  const refreshSequence = useRef(0);
  const [messages, setMessages] = useState<Message[]>(() => { const stored = personal?.history ?? loadHistory(); return stored.length ? stored : [welcome()]; });
  const [sessionId] = useState(loadSession);
  const [view, setView] = useState(loadView);
  const [continuous, setContinuous] = useState(false);
  const [voiceSound, setVoiceSound] = useState(true);
  const [notice, setNotice] = useState('');
  const [spokenText, setSpokenText] = useState('');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [backendRevision, setBackendRevision] = useState(0);
  const [model, setModel] = useState<HealthResponse['ai']>();
  const [modelOffline, setModelOffline] = useState(false);
  const [cloudSpeech, setCloudSpeech] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [autoVoice, setAutoVoice] = useState(loadVoicePreference);
  const [nearBottom, setNearBottom] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const shouldScroll = useRef(true);
  const closeModal = useCallback(() => setModal(null), []);
  const viewRef = useRef(view);
  const continuousRef = useRef(continuous);
  const soundRef = useRef(voiceSound);
  const sessionActive = useRef(false);
  const microphoneActive = useRef(false);
  const turn = useRef(0);
  const request = useRef<AbortController | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef<(text: string, source?: 'text' | 'voice') => Promise<void>>(async () => {});
  const startVoiceRef = useRef<() => void>(() => {});
  const interruptRef = useRef<(message?: string) => void>(() => {});
  viewRef.current = view;
  continuousRef.current = continuous;
  soundRef.current = voiceSound;
  const output = useSpeechOutput(cloudSpeech);
  const controller = useGamepad();
  const voice = useVoiceInput(text => {
    if (viewRef.current === 'voice') setSpokenText(previous => `${previous} ${text}`.trim().slice(0, MAX_MESSAGE_LENGTH));
    else {
      setDraft(previous => `${previous}${previous ? ' ' : ''}${text}`.slice(0, MAX_MESSAGE_LENGTH));
      textarea.current?.focus();
    }
  }, {
    captureAudio: view === 'chat',
    onComplete: text => {
      if (viewRef.current !== 'voice' || !microphoneActive.current || document.hidden) return;
      microphoneActive.current = false;
      void sendRef.current(text.slice(0, MAX_MESSAGE_LENGTH), 'voice');
    },
    onFailure: () => { microphoneActive.current = false; sessionActive.current = false; continuousRef.current = false; setContinuous(false); },
  });
  const state = voice.phase === 'recording' ? 'listening' : pending || (output.busy && !output.speaking) ? 'thinking' : output.busy ? 'speaking' : 'idle';
  const stateLabel = { listening: 'À escuta', thinking: 'Processando', speaking: 'Falando', idle: health === 'online' ? 'Pronto para conversar' : health === 'checking' ? 'Conectando ao assistente' : 'Servidor indisponível' }[state];

  useEffect(() => {
    try {
      if (!personal) localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
      localStorage.setItem('jarvis.voice.v1', String(autoVoice));
      localStorage.setItem('jarvis.view.v1', view);
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [messages, autoVoice, view, personal]);
  useEffect(() => {
    let mounted = true;
    let request: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout>;
    const verify = async () => {
      request?.abort();
      request = new AbortController();
      const current = request;
      timeout = setTimeout(() => current.abort(), 5000);
      try { const result = await checkHealth(current.signal); if (mounted && request === current) { setHealth('online'); setModel(result.ai); setModelOffline(false); setSearchEnabled(result.webSearch?.enabled === true); setCloudSpeech(!BROWSER_MODE && result.speech?.configured === true); } }
      catch { if (mounted && request === current) { setHealth(BROWSER_MODE ? 'online' : 'offline'); setModel(undefined); setModelOffline(true); setSearchEnabled(false); setCloudSpeech(false); } }
      finally { clearTimeout(timeout); }
    };
    void verify();
    const timer = setInterval(() => { if (!document.hidden) void verify(); }, 20_000);
    return () => { mounted = false; request?.abort(); request = undefined; clearTimeout(timeout); clearInterval(timer); };
  }, [backendRevision]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (log.current && shouldScroll.current) { log.current.scrollTop = log.current.scrollHeight; setNearBottom(true); }
  }, [messages, pending]);
  const interrupt = useCallback((message = 'Conversa pausada. Toque no microfone para começar novamente.') => {
    turn.current++;
    microphoneActive.current = false;
    sessionActive.current = false;
    continuousRef.current = false;
    setContinuous(false);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    request.current?.abort();
    voice.cancel();
    output.stop();
    sending.current = false;
    setPending(false);
    setNotice(message);
  }, [voice.cancel, output.stop]);
  interruptRef.current = interrupt;
  useEffect(() => {
    const visibility = () => { if (document.hidden) interruptRef.current('Conversa pausada enquanto você usa outro aplicativo. Toque para retomar.'); };
    const pageHide = () => interruptRef.current();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && viewRef.current === 'voice' && !document.querySelector('dialog[open]')) interruptRef.current();
    };
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('keydown', escape);
    window.addEventListener('pagehide', pageHide);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('pagehide', pageHide);
      turn.current++;
      microphoneActive.current = false;
      sessionActive.current = false;
      request.current?.abort();
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);
  const refreshPersonal = useCallback(async () => {
    if (!personal) return;
    const sequence = ++refreshSequence.current;
    const data = await personalSnapshot();
    if (sequence !== refreshSequence.current || sending.current) return;
    setPersonalData(data);
    setMessages(data.history.length ? data.history : [welcome()]);
  }, [personal]);
  useEffect(() => {
    if (!personal) return;
    const refresh = () => { if (!document.hidden && !sending.current) void refreshPersonal().catch(() => setNotice('Sem sincronização no momento. Seus dados salvos continuam no servidor.')); };
    const timer = setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { ++refreshSequence.current; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [personal, refreshPersonal]);
  const logout = async () => { interrupt(''); await personalRequest('logout', 'POST'); onLock?.(); };
  const clearConversation = async () => {
    interrupt('');
    try { if (personal) await personalRequest('history', 'DELETE'); setMessages([welcome()]); setError(''); shouldScroll.current = true; closeModal(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível limpar a conversa.'); }
  };
  const startVoice = () => {
    if (document.hidden || sending.current || voice.phase !== 'idle') return;
    output.stop();
    setError('');
    setNotice('');
    setSpokenText('');
    microphoneActive.current = true;
    sessionActive.current = true;
    void voice.start();
  };
  startVoiceRef.current = startVoice;
  const handleSend = async (text: string, source: 'text' | 'voice' = 'text') => {
    const content = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!content || sending.current || (source === 'text' && voice.phase !== 'idle')) return;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    output.stop();
    if (source === 'text') sessionActive.current = false;
    const token = ++turn.current;
    const current = new AbortController();
    request.current = current;
    sending.current = true;
    ++refreshSequence.current;
    setPending(true);
    setError('');
    setNotice('');
    setDraft('');
    if (viewRef.current === 'voice') setSpokenText(content);
    shouldScroll.current = true;
    const user: Message = { id: makeId(), role: 'user', content, createdAt: new Date().toISOString() };
    setMessages(previous => [...previous, user].slice(-MAX_HISTORY));
    try {
      const response = await sendMessage({ message: content, sessionId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', context: conversationContext(messages), ...(webSearch ? { webSearch: true } : {}) }, current.signal);
      if (token !== turn.current) return;
      setMessages(previous => [...previous, { id: response.id, role: 'assistant' as const, content: response.message, createdAt: response.createdAt, provider: response.provider, sources: response.sources, webSearch: response.webSearch }].slice(-MAX_HISTORY));
      setHealth('online');
      sending.current = false;
      setPending(false);
      if (personal) await refreshPersonal().catch(() => setNotice('Resposta recebida. A sincronização será tentada novamente.'));
      if (token !== turn.current) return;
      const inVoice = viewRef.current === 'voice';
      if (inVoice ? soundRef.current : autoVoice) {
        const outcome = await output.speak(response.message);
        if (token === turn.current && inVoice && outcome === 'ended' && continuousRef.current && sessionActive.current && !document.hidden) {
          resumeTimer.current = setTimeout(() => { if (token === turn.current && viewRef.current === 'voice' && continuousRef.current && sessionActive.current && !document.hidden) startVoiceRef.current(); }, 350);
        } else if (token === turn.current && outcome !== 'ended') {
          sessionActive.current = false;
          continuousRef.current = false;
          setContinuous(false);
        }
      }
    } catch (cause) {
      if (token !== turn.current) return;
      sessionActive.current = false;
      continuousRef.current = false;
      setContinuous(false);
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar. Tente novamente.');
      setDraft(previous => previous || content);
      setMessages(previous => previous.filter(message => message.id !== user.id));
    } finally {
      if (token === turn.current) { request.current = null; sending.current = false; setPending(false); }
    }
  };
  sendRef.current = handleSend;
  const changeView = (value: 'voice' | 'chat') => {
    interrupt('');
    voice.clearAudio();
    viewRef.current = value;
    setView(value);
  };
  const openVoiceModal = (value: Modal) => { interrupt(''); setModal(value); };
  const lastResponse = [...messages].reverse().find(message => message.role === 'assistant' && message.id !== 'welcome');
  const lastReply = lastResponse?.content ?? '';
  const modelStatus = modelOffline && (!BROWSER_MODE || loadBackend()) ? 'IA indisponível' : model ? `IA configurada · ${model.provider === 'groq' ? 'Groq' : 'Ollama'}` : 'IA não configurada';
  const submit = (event: FormEvent) => { event.preventDefault(); void handleSend(draft); };
  const chooseCommand = (command: string) => {
    if (command.endsWith(' ')) { setDraft(command); textarea.current?.focus(); }
    else void handleSend(command);
  };
  const formatTime = (date: string) => new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return <div className={view === 'voice' ? 'voice-shell' : 'app-shell'}>
    <a className="skip-link" href={view === 'voice' ? '#main' : '#message-input'}>{view === 'voice' ? 'Ir para o assistente' : 'Ir para a mensagem'}</a>
    {view === 'voice' && <VoiceScene
      state={state} phase={voice.phase} pending={pending} speechBusy={output.busy}
      canListen={voice.canRecognize} speechSupported={output.supported} sound={voiceSound}
      continuous={continuous} status={stateLabel}
      connection={health === 'online' ? BROWSER_MODE ? 'Modo navegador' : 'Sistema online' : health === 'checking' ? 'Conectando' : 'Sem conexão'}
      modelStatus={modelStatus}
      searchEnabled={searchEnabled} webSearch={webSearch} onWebSearch={setWebSearch}
      sources={lastResponse?.sources} searchInfo={lastResponse?.webSearch}
      error={error || voice.error || output.error} notice={notice || output.notice} transcript={voice.interim || spokenText}
      reply={lastReply} draft={draft} storageError={storageError} textareaRef={textarea}
      onDraft={setDraft} onSend={() => void handleSend(draft)}
      onMicrophone={() => { if (voice.phase === 'requesting') interrupt(); else if (voice.phase === 'recording') voice.stop(); else if (pending || output.busy) interrupt(); else startVoice(); }}
      onInterrupt={() => interrupt()} onSound={() => { interrupt(''); soundRef.current = !voiceSound; setVoiceSound(!voiceSound); }}
      onContinuous={value => { continuousRef.current = value; setContinuous(value); if (!value) sessionActive.current = false; }}
      onChat={() => changeView('chat')} onHistory={() => openVoiceModal('history')}
      onSettings={() => openVoiceModal('settings')} onHelp={() => openVoiceModal('help')}
      onReplay={() => { interrupt(''); void output.speak(lastReply); }}
    />}
    {view === 'chat' && <>
    <aside className="sidebar" aria-label="Navegação principal">
      <a className="brand" href="#main"><span className="brand-mark">J<span>.</span></span><span className="brand-name">JARVIS<span>PERSONAL ASSISTANT</span></span></a>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="navigation">
        <button data-gamepad className="nav-item active" aria-label="Assistente" onClick={() => { closeModal(); textarea.current?.focus(); }} aria-current="page"><MessageSquare size={19} /><span>Assistente</span><span className="nav-dot" /></button>
        <button data-gamepad className="nav-item" aria-label="Minhas notas" onClick={() => void handleSend('notas')} disabled={pending || voice.phase !== 'idle'}><NotebookPen size={19} /><span>Minhas notas</span></button>
        <button data-gamepad className="nav-item" aria-label="Comandos" onClick={() => setModal('help')}><CircleHelp size={19} /><span>Comandos</span><span className="nav-tag">6</span></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="local-card"><span className="local-icon"><ShieldCheck size={21} /></span><strong>Seu espaço. Seu controle.</strong><p>{model ? 'Conversa com IA e comandos de notas e cálculos.' : 'Notas e cálculos funcionam sem modelo de IA.'}</p><span className="small-tag">{model ? 'IA + COMANDOS' : 'COMANDOS LOCAIS'}</span></div>
        <button data-gamepad className="nav-item" aria-label="Preferências" onClick={() => setModal('settings')}><Settings2 size={19} /><span>Preferências</span></button>
        <div className="profile"><span className="profile-avatar">U</span><div>Seu workspace<span>JARVIS AI · v0.1</span></div><span className="profile-indicator" /></div>
      </div>
    </aside>

    <main id="main" className="main-area">
      <header className="topbar"><div><span className="eyebrow">CENTRAL DE COMANDO</span><h1>Assistente pessoal<span className="version">BETA 0.1</span></h1></div><div className="header-meta"><button data-gamepad className="chat-voice-switch" aria-label="Abrir modo voz" onClick={() => changeView('voice')}><Mic size={16} /><span>Modo voz</span></button><span className={`connection ${health}`}><span />{health === 'online' ? BROWSER_MODE ? 'Modo navegador' : 'Sistema online' : health === 'checking' ? 'Conectando' : 'Sem conexão'}</span><span className="header-date">{clock.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}<span className="meta-divider" />{clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div></header>
      <div className="workspace">
        <section className="assistant-area" aria-label="Assistente JARVIS">
          <div className="hero">
            <div className="core-wrap"><Core state={state} /><span className="core-caption"><span className={`status-dot ${state}`} />{stateLabel}</span></div>
            <div className="hero-copy"><span className="eyebrow"><span className="tiny-line" /> INTELIGÊNCIA EM SUA ROTINA</span><h2>Sempre por aqui.<br /><span>Pronto para ajudar.</span></h2><p>Uma ideia, uma conta, uma nota.<br />Vamos simplificar o seu dia.</p><span className="hero-label"><Cpu size={13} /> {model ? 'Conversa com IA + comandos locais' : 'Motor de comandos local'} <span>•</span> {modelStatus}</span></div>
            <span className="hero-coordinate" aria-hidden="true">J / 01</span>
          </div>

          <div className="quick-actions" aria-label="Sugestões de comandos">{commands.map(({ icon: Icon, title, command, detail }) => <button data-gamepad key={title} onClick={() => chooseCommand(command)} disabled={pending || voice.phase !== 'idle'}><span className="action-icon"><Icon size={18} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowRight size={16} className="action-arrow" /></button>)}</div>

          <section className="chat-panel" aria-labelledby="chat-heading">
            <div className="chat-heading"><div><span className="chat-heading-icon"><MessageSquare size={17} /></span><h2 id="chat-heading">Conversa</h2><span className="chat-subtitle">Seu espaço para começar</span></div><button data-gamepad className="icon-button" title="Limpar conversa" aria-label="Limpar conversa" disabled={pending || voice.phase !== 'idle'} onClick={() => setModal('clear')}><Trash2 size={16} /></button></div>
            <div ref={log} className="message-log" role="log" aria-label="Mensagens da conversa" aria-live="polite" aria-relevant="additions" tabIndex={0} onScroll={() => { if (log.current) { const bottom = log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 60; shouldScroll.current = bottom; setNearBottom(bottom); } }}>
              {messages.map(message => <article className={`message message-${message.role}`} key={message.id}>
                <span className={`message-avatar ${message.role === 'assistant' ? 'jarvis-avatar' : ''}`} aria-hidden="true">{message.role === 'assistant' ? 'J' : 'U'}</span>
                <div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'JARVIS' : 'Você'}</strong>{message.role === 'assistant' && <span className="message-badge">{message.webSearch ? 'WEB' : message.provider && message.provider !== 'local' ? 'IA' : 'LOCAL'}</span>}<time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></div><p>{message.content}</p><SearchSources sources={message.sources} info={message.webSearch} />{message.role === 'assistant' && output.supported && <button data-gamepad className="read-button" onClick={() => output.speak(message.content)} aria-label="Ouvir resposta"><Volume2 size={13} /> Ouvir</button>}</div>
              </article>)}
              {pending && <div className="thinking" role="status"><span className="message-avatar jarvis-avatar">J</span><span className="thinking-dots"><i /><i /><i /></span><span>Processando seu pedido</span></div>}
            </div>
            {!nearBottom && <button data-gamepad className="latest-button" onClick={() => { shouldScroll.current = true; if (log.current) log.current.scrollTop = log.current.scrollHeight; setNearBottom(true); }}><ArrowDown size={14} /> Últimas mensagens</button>}
            <div className="composer-area">
              {error && <p className="inline-error" role="alert"><WifiOff size={16} />{error}</p>}
              {(voice.error || output.error) && <p className="inline-error" role="alert">{voice.error || output.error}</p>}
              {output.notice && <p className="support-note">{output.notice}</p>}
              {voice.phase !== 'idle' && <div className="recording-notice" role="status"><AudioLines size={17} /><span>{voice.phase === 'requesting' ? 'Aguardando permissão do microfone…' : voice.interim || 'Ouvindo… fale seu comando e revise antes de enviar.'}</span>{voice.phase === 'recording' && <span className="recording-limit">Até 60 s</span>}</div>}
              {voice.audioUrl && <div className="audio-preview"><span>Seu áudio · apenas neste navegador</span><audio controls src={voice.audioUrl} aria-label="Reproduzir áudio gravado" /><button data-gamepad className="icon-button" aria-label="Descartar gravação" onClick={voice.clearAudio}><X size={16} /></button></div>}
              <form className={`composer ${voice.phase === 'recording' ? 'is-recording' : ''}`} onSubmit={submit}>
                <textarea data-gamepad ref={textarea} id="message-input" aria-label="Sua mensagem para JARVIS" placeholder="O que vamos fazer hoje?" rows={1} maxLength={MAX_MESSAGE_LENGTH} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSend(draft); } }} />
                <span className="composer-divider" />
                <button data-gamepad type="button" className={`mic-button ${voice.phase === 'recording' ? 'recording' : ''}`} aria-label={voice.phase === 'recording' ? 'Parar gravação' : voice.phase === 'requesting' ? 'Cancelar solicitação do microfone' : 'Ativar microfone'} aria-pressed={voice.phase === 'recording'} disabled={!voice.canRecord || pending} title={!voice.canRecord ? 'Microfone indisponível. Use HTTPS e um navegador compatível ou digite.' : 'Ativar microfone; o navegador pode usar um serviço de reconhecimento de voz.'} onClick={() => { output.stop(); if (voice.phase === 'requesting') voice.cancelRequest(); else if (voice.phase === 'recording') voice.stop(); else void voice.start(); }}>{voice.phase !== 'idle' ? <Square size={18} /> : <Mic size={20} />}</button>
                <button data-gamepad className="send-button" type="submit" aria-label="Enviar mensagem" disabled={!draft.trim() || pending || voice.phase !== 'idle'}><Send size={18} /></button>
              </form>
              <SearchToggle enabled={searchEnabled} checked={webSearch} disabled={pending || voice.phase !== 'idle'} onChange={setWebSearch} />
              <div className="composer-footer"><span><ShieldCheck size={12} /> Histórico salvo neste navegador</span><span className="keyboard-hint"><kbd>Enter</kbd> enviar <span>·</span> <kbd>Shift + Enter</kbd> nova linha</span><span className="char-count" aria-live="off">{draft.length > 1800 ? `${draft.length}/${MAX_MESSAGE_LENGTH}` : ''}</span></div>
              {!voice.canRecognize && <p className="support-note">Reconhecimento de voz indisponível neste navegador. {voice.canRecord ? 'Você pode gravar e ouvir o áudio; envie seu pedido por texto.' : 'Continue pela digitação.'}</p>}
            </div>
          </section>
          {storageError && <p className="inline-error" role="alert">O navegador bloqueou o armazenamento ou ficou sem espaço. O histórico desta sessão pode não ser salvo.</p>}
          <footer className="workspace-footer"><span>Projetado para deixar o dia mais leve.</span><span>JARVIS AI <span className="footer-dot">•</span> MVP 0.1</span></footer>
        </section>

        <aside className="insights" aria-label="Informações do sistema">
          <section className="info-panel"><div className="panel-title"><Activity size={16} /><h2>Status do sistema</h2><span className="panel-dot" /></div><div className="system-visual"><div className="system-chip"><Cpu size={25} /></div><div><strong>JARVIS Core</strong><span>Motor de comandos · v0.1</span></div></div><dl className="status-list"><div><dt>{BROWSER_MODE ? 'Execução' : 'Servidor'}</dt><dd className={health === 'online' ? 'status-good' : ''}>{health === 'online' ? <><span /> {BROWSER_MODE ? 'Neste navegador' : 'Conectado'}</> : health === 'checking' ? 'Verificando' : 'Indisponível'}</dd></div><div><dt>Processamento</dt><dd>{model ? 'IA + comandos' : 'Comandos locais'}</dd></div><div><dt>Histórico</dt><dd>{personal ? 'Na sua conta' : storageError ? 'Não persistido' : 'No navegador'}</dd></div><div><dt>Modelo de IA</dt><dd className="muted">{modelStatus}</dd></div></dl><div className="system-footnote"><ShieldCheck size={13} /> Credenciais do modelo ficam no servidor</div></section>
          <section className="info-panel voice-panel"><div className="panel-title"><AudioLines size={16} /><h2>Voz & interação</h2></div><div className="capability"><span className="capability-icon"><Mic size={16} /></span><div><strong>Reconhecimento</strong><span>{voice.canRecognize && voice.canRecord ? 'Disponível no navegador' : 'Use a digitação'}</span></div>{voice.canRecognize && voice.canRecord ? <Check size={15} className="capability-check" /> : <Keyboard size={15} className="muted" />}</div><div className="capability"><span className="capability-icon"><Volume2 size={16} /></span><div><strong>Respostas faladas</strong><span>{output.supported ? autoVoice ? 'Leitura automática ativa' : 'Toque em “Ouvir”' : 'Não suportadas'}</span></div><button data-gamepad className="icon-button" disabled={!output.supported} aria-label={output.speaking ? 'Parar leitura' : 'Configurar respostas faladas'} onClick={() => output.speaking ? output.stop() : setModal('settings')}>{output.speaking ? <VolumeX size={16} /> : <Settings2 size={15} />}</button></div><div className="capability"><span className="capability-icon"><Gamepad2 size={16} /></span><div><strong>Controle & teclado</strong><span>{controller ? 'Controle detectado · A para ativar' : 'Tab para navegar · Enter para ativar'}</span></div></div><p className="panel-note">A voz depende das permissões e dos recursos do seu navegador.</p></section>
          <section className="tip-card"><span className="tip-icon"><Sparkles size={18} /></span><span className="eyebrow">UMA IDEIA PARA COMEÇAR</span><h2>Tire da cabeça.<br />Guarde aqui.</h2><p>Uma ideia boa merece uma nota. O JARVIS guarda para você.</p><button data-gamepad disabled={pending || voice.phase !== 'idle'} onClick={() => chooseCommand('anotar ')}>Criar minha primeira nota <ChevronRight size={15} /></button><div className="tip-orbit" aria-hidden="true" /></section>
          <button data-gamepad className="help-link" onClick={() => setModal('help')}><CircleHelp size={15} /> Conheça os comandos <ArrowRight size={14} /></button>
        </aside>
      </div>
    </main>
    </>}

    {modal && <Dialog key={modal} title={modal === 'help' ? 'O que o JARVIS pode fazer' : modal === 'settings' ? 'Seu assistente, do seu jeito' : modal === 'history' ? 'Histórico da conversa' : modal === 'memory' ? 'Memória pessoal' : 'Limpar esta conversa?'} onClose={closeModal}>
      {modal === 'help' && <><p className="modal-description">{model ? 'Faça perguntas e peça ajuda com textos e estudos. Para notas e cálculos, use os comandos abaixo.' : 'Os comandos abaixo já funcionam. A conversa com IA exige um backend e um modelo configurados em Preferências.'}</p><div className="command-list">{[['hora', 'Consultar o horário'], ['data', 'Ver a data de hoje'], ['calcular (12 + 8) / 2', 'Calcular uma expressão'], ['pesquise ', 'Pesquisar na web com fontes'], ['anotar ', personal ? 'Guardar uma nota na sua conta' : BROWSER_MODE ? 'Guardar uma nota neste navegador' : 'Guardar uma nota no SQLite'], ...(personal ? [['lembre que ', 'Salvar uma preferência pessoal'], ['minhas memórias', 'Consultar memórias salvas'], ['qual é meu nome', 'Consultar seu nome salvo'], ['corrija memória 1 para ', 'Corrigir uma memória'], ['esqueça memória 1', 'Apagar uma memória']] : []), ['notas', 'Ler suas notas'], ['apagar notas', 'Excluir todas as suas notas']].map(([command, label]) => <button data-gamepad key={command} disabled={pending || voice.phase !== 'idle'} onClick={() => { closeModal(); chooseCommand(command); }}><span><strong>{label}</strong><code>{command === 'anotar ' ? 'anotar comprar leite' : command === 'pesquise ' ? 'pesquise notícias de tecnologia' : command}</code></span><ArrowRight size={17} /></button>)}</div><p className="privacy-note">{personal ? '“Apagar notas” remove as notas da conta. Limpar o histórico preserva notas e memórias.' : BROWSER_MODE ? '“Apagar notas” exclui as notas deste navegador. Limpar a conversa preserva as notas. Elas não são sincronizadas entre dispositivos.' : '“Apagar notas” exclui as notas da sua sessão. Elas ficam no servidor e não são removidas ao limpar a conversa. Não use este MVP para informações sensíveis em um servidor público.'}</p></>}
      {modal === 'memory' && personalData && <PersonalMemory snapshot={personalData} onRefresh={refreshPersonal} onLogout={logout} />}
      {modal === 'settings' && <>{personal && <button data-gamepad className="primary-button" onClick={() => setModal('memory')}>Memória pessoal</button>}<p className="modal-description">Texto sempre disponível. Áudio quando você escolher.</p><label className="setting-row"><span><strong>Ler respostas automaticamente no chat</strong><small>{output.supported ? 'Usa o tipo de voz escolhido abaixo.' : 'Síntese de voz indisponível neste navegador.'}</small></span><input data-gamepad type="checkbox" disabled={!output.supported} checked={autoVoice} onChange={event => { setAutoVoice(event.target.checked); if (!event.target.checked) output.stop(); }} /></label><SpeechSettings output={output} />{BROWSER_MODE ? <AIConnection onChange={() => { interrupt(''); setBackendRevision(previous => previous + 1); }} /> : <p className="privacy-note">{modelStatus}. O modelo é configurado no servidor. Mensagens recentes acompanham perguntas à IA; a chave fica no backend.</p>}<div className="settings-detail"><ShieldCheck size={19} /><div><strong>{personal ? 'Histórico na sua conta' : 'Histórico no navegador'}</strong><p>{personal ? 'Até 100 mensagens, notas e preferências ficam no servidor e aparecem nos aparelhos conectados à sua conta. As memórias salvas podem ser enviadas à IA junto com perguntas. Você pode apagá-las em Memória pessoal.' : BROWSER_MODE ? 'Histórico e notas ficam neste navegador. Notas e cálculos são processados aqui. Quando você conecta um backend, perguntas à IA enviam a mensagem e o contexto recente ao servidor e ao provedor. Pesquisas enviam o assunto ao buscador; trechos dos resultados podem acompanhar o resumo por IA. Até 100 mensagens e 100 notas são mantidas.' : 'Até 100 mensagens são salvas neste dispositivo. A conversa e o contexto recente são enviados ao backend para responder, e ao provedor quando usa IA. O backend não armazena as mensagens. Notas são persistidas em SQLite por sessão. Pesquisas enviam o assunto ao buscador e os trechos ao modelo para o resumo.'}</p></div></div><div className="settings-detail"><Mic size={19} /><div><strong>Você controla o microfone</strong><p>O microfone só é ativado após seu clique e permissão. No modo chat, o áudio gravado fica temporariamente neste navegador. No modo voz, apenas a transcrição entra no histórico. O reconhecimento de voz pode usar serviços externos do próprio navegador; confira sua política de privacidade.</p></div></div><div className="settings-detail"><Gamepad2 size={19} /><div><strong>Navegação acessível</strong><p>Use Tab e Shift + Tab, ou o direcional de um controle padrão. A ativa o item; B fecha esta janela. A digitação no Xbox depende do teclado virtual do Edge.</p></div></div><p className="privacy-note">Animações respeitam a preferência de movimento reduzido do sistema. O MVP não controla seu sistema operacional.</p></>}
      {modal === 'history' && <><p className="modal-description">{personal ? 'Suas conversas sincronizadas com a conta. Você pode continuar em outro aparelho.' : 'Suas conversas neste navegador. Você também pode continuar pelo modo chat.'}</p><div className="history-log" role="log" aria-label="Histórico de mensagens" tabIndex={0}>{messages.map(message => <article className={`message message-${message.role}`} key={message.id}><span className={`message-avatar ${message.role === 'assistant' ? 'jarvis-avatar' : ''}`} aria-hidden="true">{message.role === 'assistant' ? 'J' : 'U'}</span><div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'JARVIS' : 'Você'}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></div><p>{message.content}</p><SearchSources sources={message.sources} info={message.webSearch} /></div></article>)}</div><div className="dialog-actions"><button data-gamepad className="secondary-button" onClick={() => setModal('clear')}>Limpar conversa</button><button data-gamepad className="primary-button" onClick={() => { closeModal(); changeView('chat'); }}>Abrir modo chat</button></div></>}
      {modal === 'clear' && <><p className="modal-description">{personal ? 'As mensagens serão removidas da conta e dos aparelhos na próxima sincronização.' : 'As mensagens serão removidas do histórico deste navegador.'} {BROWSER_MODE ? 'Suas notas neste navegador serão preservadas.' : 'Suas notas no servidor serão preservadas.'}</p><div className="dialog-actions"><button data-gamepad className="secondary-button" onClick={closeModal}>Cancelar</button><button data-gamepad className="primary-button" onClick={() => void clearConversation()}>Limpar conversa</button></div></>}
    </Dialog>}
  </div>;
}
