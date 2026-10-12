import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Gamepad2, Mic, ShieldCheck, Square, Volume2 } from 'lucide-react';
import { ParticleOrb } from './components/ParticleOrb';
import { ModernIcon } from './components/ModernIcon';
import { personalProfile } from '../shared/memory';
import { PersonalMemory } from './components/PersonalMemory';
import { SpeechSettings } from './components/SpeechSettings';
import { personalRequest, personalSnapshot } from './lib/personal';
import type { PersonalSnapshot } from '../shared/contracts';
import { AIConnection } from './components/AIConnection';
import { SearchSources } from './components/SearchSources';
import { SearchStatus } from './components/SearchStatus';
import { Dialog } from './components/Dialog';
import { useGamepad } from './hooks/useGamepad';
import { useSpeechOutput, useVoiceInput, useSpeechInterrupt, type SpeechOutcome } from './hooks/useVoice';
import { BROWSER_MODE, checkHealth, sendMessage } from './lib/api';
import { HISTORY_KEY, MAX_HISTORY, loadHistory, loadSession, loadVoicePreference, loadView, makeId } from './lib/storage';
import { MAX_MESSAGE_LENGTH, type Message } from '../shared/contracts';
import type { HealthResponse } from '../shared/contracts';
import { conversationContext } from '../shared/context';
import { loadBackend } from './lib/backend';
import { speechParts } from '../shared/speech';
import { loadReception, personalGreeting, RECEPTION_KEY } from './lib/reception';
import { Reception, ReceptionSettings } from './components/Reception';
import { ConversationTiming, type TurnTiming } from './components/ConversationTiming';
import { Projects, ProjectPriorities, ProposalReview, Tasks } from './components/Projects';
import type { ProjectProposal } from '../shared/projects';
import { Knowledge, KnowledgeSources } from './components/Knowledge';

const loadToggle = (key: string, fallback = false) => { try { const value = localStorage.getItem(key); return value === null ? fallback : value === 'true'; } catch { return fallback; } };

const welcome = (): Message => ({ id: 'welcome', role: 'assistant', content: 'Olá, sou o JARVIS. Seu espaço para pensar, organizar e resolver. Experimente um comando abaixo ou digite “ajuda” para começar.', createdAt: new Date().toISOString() });
const lastSpokenText = (messages: Message[]) => [...messages].reverse().find(message => message.role === 'assistant')?.content ?? '';
type WorkspaceView = 'Conversa' | 'Projetos' | 'Tarefas' | 'Memória';
type Modal = 'help' | 'settings' | 'clear' | 'history' | 'memory' | 'projects' | 'knowledge' | null;

export default function App({ personal, onLock }: { personal?: PersonalSnapshot; onLock?: () => void } = {}) {
  useLayoutEffect(() => { document.body.classList.add('jarvis-modern-app'); return () => document.body.classList.remove('jarvis-modern-app'); }, []);
  const [personalData, setPersonalData] = useState(personal);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('Conversa');
  const [proposal, setProposal] = useState<ProjectProposal>();
  const [savingProposal, setSavingProposal] = useState(false);
  const [openedNote, setOpenedNote] = useState<{ id: string; revision: number }>();
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
  const [readingParts, setReadingParts] = useState(false);
  const [partial, setPartial] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [timing, setTiming] = useState<TurnTiming>();
  const [connectionMs, setConnectionMs] = useState<number>();
  const [fastVoice, setFastVoice] = useState(() => loadToggle('jarvis.fast-voice.v1', true));
  const [voiceInterrupt, setVoiceInterrupt] = useState(() => loadToggle('jarvis.voice-interrupt.v1'));
  const [reception, setReception] = useState(loadReception);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [backendRevision, setBackendRevision] = useState(0);
  const [model, setModel] = useState<HealthResponse['ai']>();
  const [modelOffline, setModelOffline] = useState(false);
  const [cloudSpeech, setCloudSpeech] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
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
  const autoVoiceRef = useRef(autoVoice);
  const sessionActive = useRef(false);
  const microphoneActive = useRef(false);
  const turn = useRef(0);
  const request = useRef<AbortController | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef<(text: string, source?: 'text' | 'voice') => Promise<boolean>>(async () => false);
  const startVoiceRef = useRef<() => void>(() => {});
  const interruptRef = useRef<(message?: string) => void>(() => {});
  viewRef.current = view;
  continuousRef.current = continuous;
  soundRef.current = voiceSound;
  autoVoiceRef.current = autoVoice;
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
  const state = voice.phase === 'recording' ? 'listening' : pending || ((output.busy || readingParts) && !output.speaking) ? 'thinking' : output.busy || readingParts ? 'speaking' : 'idle';
  const stateLabel = { listening: 'Ouvindo você', thinking: 'Organizando as ideias', speaking: 'Respondendo', idle: health === 'online' ? 'Pronto para conversar' : health === 'checking' ? 'Conectando ao assistente' : 'Servidor indisponível' }[state];

  useEffect(() => {
    try {
      if (!personal) localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
      localStorage.setItem('jarvis.voice.v2', String(autoVoice));
      localStorage.setItem('jarvis.view.v1', view);
      localStorage.setItem('jarvis.fast-voice.v1', String(fastVoice));
      localStorage.setItem('jarvis.voice-interrupt.v1', String(voiceInterrupt));
      localStorage.setItem(RECEPTION_KEY, JSON.stringify(reception));
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [messages, autoVoice, view, personal, fastVoice, voiceInterrupt, reception]);
  useEffect(() => {
    let mounted = true;
    let request: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout>;
    const verify = async () => {
      request?.abort();
      request = new AbortController();
      const current = request;
      timeout = setTimeout(() => current.abort(), 5000);
      const started = performance.now();
      try { const result = await checkHealth(current.signal); if (mounted && request === current) { setConnectionMs(Math.round(performance.now() - started)); setStreaming(result.streaming === true); setHealth('online'); setModel(result.ai); setModelOffline(false); setSearchEnabled(result.webSearch?.enabled === true); setCloudSpeech(!BROWSER_MODE && result.speech?.configured === true); } }
      catch { if (mounted && request === current) { setHealth(BROWSER_MODE ? 'online' : 'offline'); setModel(undefined); setModelOffline(true); setSearchEnabled(false); setCloudSpeech(false); setStreaming(false); } }
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
  }, [messages, pending, partial]);
  const interrupt = useCallback((message = 'Conversa pausada. Toque no microfone para começar novamente.') => {
    turn.current++;
    microphoneActive.current = false;
    sessionActive.current = false;
    continuousRef.current = false;
    setContinuous(false);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    request.current?.abort();
    voice.cancel();
    output.stop();
    sending.current = false;
    setPending(false);
    setReadingParts(false);
    setPartial('');
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
    try { if (personal) await personalRequest('history', 'DELETE'); setProposal(undefined); setMessages([welcome()]); setWorkspaceView('Conversa'); setError(''); shouldScroll.current = true; closeModal(); if (personal) await refreshPersonal(); }
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
  const speakResponse = async (text: string, signal: AbortSignal, token: number, onFirst?: () => void): Promise<SpeechOutcome> => {
    setReadingParts(true);
    const parts = fastVoice ? speechParts(text) : [text];
    let outcome: SpeechOutcome = 'ended';
    let prepared: Promise<boolean> | undefined;
    const preparation = new AbortController();
    const cancelPreparation = () => preparation.abort();
    signal.addEventListener('abort', cancelPreparation, { once: true });
    if (signal.aborted) cancelPreparation();
    try {
      for (let index = 0; index < parts.length; index++) {
        if (token !== turn.current || signal.aborted) return 'canceled';
        if (index > 0 && prepared && !await prepared) {
          if (token !== turn.current || signal.aborted) return 'canceled';
          if (output.engine === 'auto') {
            setNotice(previous => `${previous} Usando a voz do aparelho para concluir.`);
            outcome = await output.speak(parts[index], 'browser');
          } else outcome = 'error';
          break;
        }
        if (token !== turn.current || signal.aborted) return 'canceled';
        outcome = await output.speak(parts[index], undefined, via => {
          if (token !== turn.current) return;
          if (index === 0) {
            onFirst?.();
            if (parts[1] && via === 'elevenlabs') {
              prepared = output.prepare(parts[1], preparation.signal).then(() => true, cause => {
                if (token === turn.current && !preparation.signal.aborted) setNotice(cause instanceof Error ? cause.message : 'A segunda parte da voz ficou indisponível. A resposta completa está no texto.');
                return false;
              });
            }
          }
        });
        if (outcome !== 'ended') break;
      }
      return outcome;
    } finally { cancelPreparation(); signal.removeEventListener('abort', cancelPreparation); if (token === turn.current) setReadingParts(false); }
  };
  const replayResponse = (text: string) => {
    interrupt('');
    const token = turn.current; const current = new AbortController(); request.current = current;
    void speakResponse(text, current.signal, token).finally(() => { if (token === turn.current) request.current = null; });
  };
  const handleSend = async (text: string, source: 'text' | 'voice' | 'briefing' = 'text') => {
    const content = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!content || sending.current || (source !== 'voice' && voice.phase !== 'idle')) return false;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    output.stop();
    if (source !== 'voice') sessionActive.current = false;
    setReadingParts(false);
    request.current?.abort();
    const token = ++turn.current;
    const started = performance.now();
    setTiming(source === 'voice' ? { recognitionMs: voice.getDurationMs() } : {});
    setPartial('');
    const current = new AbortController();
    request.current = current;
    sending.current = true;
    ++refreshSequence.current;
    setPending(true);
    setWorkspaceView('Conversa');
    setError('');
    setNotice('');
    setDraft('');
    setProposal(undefined);
    if (viewRef.current === 'voice') setSpokenText(content);
    shouldScroll.current = true;
    const user: Message = { id: makeId(), role: 'user', content, createdAt: new Date().toISOString() };
    setMessages(previous => [...previous, user].slice(-MAX_HISTORY));
    try {
      const response = await sendMessage({ message: content, sessionId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', context: conversationContext(messages), ...(source === 'voice' || (source === 'briefing' && reception.readNews) ? { voice: true } : {}), ...(streaming ? { stream: true } : {}) }, current.signal, {
        onReady: () => { if (token === turn.current) setTiming(previous => ({ ...previous, readyMs: Math.round(performance.now() - started) })); },
        onText: text => { if (token === turn.current) { setPartial(text); setTiming(previous => ({ ...previous, firstTextMs: previous?.firstTextMs ?? Math.round(performance.now() - started) })); } },
      });
      if (token !== turn.current) return false;
      setPartial('');
      setProposal(response.proposal);
      setTiming(previous => ({ ...previous, requestMs: Math.round(performance.now() - started), firstTextMs: previous?.firstTextMs ?? Math.round(performance.now() - started), server: response.timings }));
      setMessages(previous => [...previous, { id: response.id, role: 'assistant' as const, content: response.message, createdAt: response.createdAt, provider: response.provider, sources: response.sources, webSearch: response.webSearch, knowledgeSources: response.knowledgeSources }].slice(-MAX_HISTORY));
      setHealth('online');
      sending.current = false;
      setPending(false);
      if (personal) void refreshPersonal().catch(() => setNotice('Resposta recebida. A sincronização será tentada novamente.'));
      if (token !== turn.current) return false;
      const inVoice = viewRef.current === 'voice';
      if (source === 'briefing' ? reception.readNews : inVoice ? soundRef.current : autoVoiceRef.current) {
        const outcome = await speakResponse(response.message, current.signal, token, () => setTiming(previous => ({ ...previous, firstAudioMs: Math.round(performance.now() - started) })));
        if (token === turn.current && inVoice && outcome === 'ended' && continuousRef.current && sessionActive.current && !document.hidden) {
          resumeTimer.current = setTimeout(() => { resumeTimer.current = null; if (token === turn.current && viewRef.current === 'voice' && continuousRef.current && sessionActive.current && !document.hidden) startVoiceRef.current(); }, 350);
        } else if (token === turn.current && outcome !== 'ended') {
          sessionActive.current = false;
          continuousRef.current = false;
          setContinuous(false);
        }
      }
      return true;
    } catch (cause) {
      if (token !== turn.current) return false;
      setPartial('');
      sessionActive.current = false;
      continuousRef.current = false;
      setContinuous(false);
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar. Tente novamente.');
      setDraft(previous => previous || content);
      setMessages(previous => previous.filter(message => message.id !== user.id));
      return false;
    } finally {
      if (token === turn.current) { request.current = null; sending.current = false; setPending(false); }
    }
  };
  sendRef.current = handleSend;
  const interruptError = useSpeechInterrupt(voiceInterrupt && view === 'voice' && output.speaking && sessionActive.current, lastSpokenText(messages), () => interrupt('Resposta interrompida pela sua voz. Toque no microfone para continuar.'));
  const greeting = personalGreeting(personalData?.memories ?? [], clock);
  const confirmProposal = async () => {
    if (!proposal || savingProposal || pending) return;
    interrupt(''); setSavingProposal(true); setError('');
    try { await personalRequest('projects/confirm', 'POST', { proposal }); setProposal(undefined); await refreshPersonal(); setNotice('Proposta aplicada. Seus projetos estão atualizados.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível aplicar a proposta.'); await refreshPersonal().catch(() => {}); }
    finally { setSavingProposal(false); }
  };
  const openKnowledge = (id?: string, revision?: number) => { interrupt(''); setOpenedNote(id && revision ? { id, revision } : undefined); setModal('knowledge'); };
  const receptionPanel = personalData ? <>
    <Reception preferences={reception} greeting={greeting} enabled={searchEnabled} busy={pending || output.busy || readingParts || voice.phase !== 'idle' || !!modal} speechSupported={output.supported}
      onSpeak={() => { interrupt(''); void output.speak(greeting); }} onNews={() => { closeModal(); return handleSend(`pesquise últimas notícias sobre ${reception.topic.trim() || 'tecnologia'}`, 'briefing'); }} />
    <ProjectPriorities snapshot={personalData} now={clock} onOpen={() => { interrupt(''); setModal('projects'); }} onPlan={() => void handleSend('Planeje meu dia')} busy={pending || voice.phase !== 'idle'} />
    <div className="knowledge-entry"><button data-gamepad className="secondary-button" onClick={() => openKnowledge()}>Notas do Obsidian</button><small>{personalData.library?.length ?? 0} nota(s) importada(s)</small></div>
  </> : undefined;
  const proposalReview = proposal && personalData ? <ProposalReview proposal={proposal} snapshot={personalData} busy={savingProposal || pending} onConfirm={confirmProposal} onDismiss={() => setProposal(undefined)} /> : undefined;
  const changeView = (value: 'voice' | 'chat') => {
    interrupt('');
    voice.clearAudio();
    viewRef.current = value;
    setView(value);
  };
  const openVoiceModal = (value: Modal) => {
    const keepTextRequest = value === 'settings' && view === 'chat' && pending && voice.phase === 'idle';
    if (!keepTextRequest && (voice.phase !== 'idle' || pending || output.busy || readingParts || resumeTimer.current)) interrupt('');
    setModal(value);
  };
  const modelStatus = modelOffline && (!BROWSER_MODE || loadBackend()) ? 'IA indisponível' : model ? `IA configurada · ${model.provider === 'groq' ? 'Groq' : 'Ollama'}` : 'IA não configurada';
  const submit = (event: FormEvent) => { event.preventDefault(); void handleSend(draft); };
  const chooseCommand = (command: string) => {
    if (command.endsWith(' ')) { setDraft(command); textarea.current?.focus(); }
    else void handleSend(command);
  };
  const formatTime = (date: string) => new Date(date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const profileName = personalProfile(personalData?.memories ?? []).name;
  const displayName = profileName || 'Seu perfil';
  const headingGreeting = greeting.split('. Estou por aqui.')[0] + '.';
  const conversation = messages.filter(message => message.id !== 'welcome');
  const turns: { user?: Message; answer?: Message }[] = [];
  for (const message of conversation) {
    const last = turns.at(-1);
    if (message.role === 'user') turns.push({ user: message });
    else if (last?.user && !last.answer) last.answer = message;
    else turns.push({ answer: message });
  }
  const busy = pending || output.busy || readingParts;
  const microphoneLabel = voice.phase === 'requesting' ? 'Cancelar solicitação do microfone' : voice.phase === 'recording' ? view === 'voice' ? 'Encerrar escuta' : 'Parar gravação' : busy ? 'Interromper resposta' : view === 'voice' ? 'Falar com JARVIS' : 'Ativar microfone';
  const microphone = () => {
    if (voice.phase === 'requesting') interrupt();
    else if (voice.phase === 'recording') voice.stop();
    else if (busy) interrupt();
    else if (view === 'voice') startVoice();
    else { interrupt(''); void voice.start(); }
  };
  const navigate = (next: WorkspaceView) => { interrupt(''); setWorkspaceView(next); if (next === 'Conversa') textarea.current?.focus(); };
  const unavailable = (feature: string) => <div className="jd-chat"><strong>{feature}</strong>Este recurso exige o acesso à sua conta pessoal neste servidor. Nenhum dado foi criado.</div>;

  return <div className="reference-frame">
    <a className="skip-link" href="#main">Ir para o assistente</a>
    <div id="jarvis-moderno" data-continuous={continuous}>
      <aside className="jd-sidebar" aria-label="Navegação principal">
        <div className="jd-brand"><span className="jd-brand-dot" aria-hidden="true" />JARVIS</div>
        <button data-gamepad type="button" aria-label="Nova conversa" className="jd-new" onClick={() => openVoiceModal('clear')}><ModernIcon name="plus" />Nova conversa</button>
        <nav aria-label="Menu do JARVIS">{([['Conversa', 'conversation'], ['Projetos', 'projects'], ['Tarefas', 'tasks'], ['Memória', 'memory']] as const).map(([name, icon]) =>
          <button data-gamepad type="button" key={name} aria-label={name} aria-pressed={workspaceView === name} onClick={() => navigate(name)}><ModernIcon name={icon} />{name}</button>)}</nav>
        <div className="jd-section-name">SEU ESPAÇO</div>
        <button data-gamepad type="button" className="jd-project" onClick={() => { setWorkspaceView('Conversa'); void handleSend('Continuar o JARVIS'); }} disabled={pending || voice.phase !== 'idle'}><span className="jd-dot" />JARVIS</button>
        <button data-gamepad type="button" className="jd-project" onClick={() => { setWorkspaceView('Conversa'); void handleSend('Revisar o Prospect AI'); }} disabled={pending || voice.phase !== 'idle'}><span className="jd-dot" />Prospect AI</button>
        <button data-gamepad type="button" className="jd-project" aria-label="Notas do Obsidian" onClick={() => personalData ? openKnowledge() : setNotice('As notas do Obsidian exigem acesso à sua conta pessoal.')}><span className="jd-dot" />Segundo cérebro</button>
        <button data-gamepad type="button" className="jd-profile" aria-label="Abrir perfil pessoal" onClick={() => personalData ? navigate('Memória') : openVoiceModal('settings')}><span className="jd-avatar">{profileName?.[0]?.toUpperCase() || 'U'}</span><span>{displayName}<small>Meu assistente pessoal</small></span></button>
      </aside>
      <main id="main" tabIndex={-1}>
        <header className="jd-top"><div><span className="jd-crumb">Meu espaço</span><span className="jd-slash">/</span><span className="jd-current">{workspaceView}</span></div><button data-gamepad type="button" className="jd-preview" aria-label="Preferências" title="Abrir preferências" onClick={() => openVoiceModal('settings')}>{health === 'online' ? BROWSER_MODE ? 'Modo navegador' : 'Sistema online' : health === 'checking' ? 'Conectando' : 'Sem conexão'}</button></header>
        <div className="jd-main">
          <ParticleOrb state={state} level={state === 'listening' ? voice.audioLevel : state === 'speaking' ? output.audioLevel : undefined} />
          <div className="jp-status" role="status" aria-live="polite">{stateLabel}</div>
          <div className="jd-welcome" hidden={workspaceView === 'Conversa' && conversation.length > 0}><h2>{headingGreeting}</h2><p>O que vamos construir hoje?</p></div>
          <div className="jd-content">
            {workspaceView === 'Conversa' && <>
              {!conversation.length && <div className="jd-suggestions" aria-label="Sugestões de conversa">
                <button data-gamepad type="button" aria-label="Planejar meu dia" disabled={pending || voice.phase !== 'idle'} onClick={() => void handleSend('Planeje meu dia')}><ModernIcon name="calendar" />Organizar meu dia</button>
                <button data-gamepad type="button" disabled={pending || voice.phase !== 'idle'} onClick={() => void handleSend('Continuar o JARVIS')}><ModernIcon name="code" />Continuar o JARVIS</button>
                <button data-gamepad type="button" onClick={() => personalData ? openKnowledge() : void handleSend('notas')} disabled={pending || voice.phase !== 'idle'}><ModernIcon name="notes" />Ver minhas notas</button>
              </div>}
              <div ref={log} className="jd-message-log" role="log" aria-label="Mensagens da conversa" aria-live="polite" aria-relevant="additions" tabIndex={conversation.length ? 0 : undefined} onScroll={() => { if (log.current) { const bottom = log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 60; shouldScroll.current = bottom; setNearBottom(bottom); } }}>
                {turns.map(({ user, answer }, index) => <article className="jd-chat" key={user?.id ?? answer!.id}>
                  <strong className={user ? 'message-user' : undefined}>{user?.content ?? 'JARVIS'}</strong>
                  {answer && <div className="message-assistant" data-provider={answer.provider ?? 'local'}>
                    <p>{answer.content}</p><SearchSources sources={answer.sources} info={answer.webSearch} />{personalData && <KnowledgeSources sources={answer.knowledgeSources} onOpen={openKnowledge} />}
                    {output.supported && <button data-gamepad className="read-button" onClick={() => replayResponse(answer.content)} aria-label="Ouvir resposta"><Volume2 size={13} />Ouvir</button>}
                  </div>}
                  {!answer && index === turns.length - 1 && (partial ? <div className="message-assistant" aria-label="Resposta em andamento"><p>{partial}</p></div> : pending ? <div>Pensando…</div> : null)}
                </article>)}
              </div>
              {!nearBottom && <button data-gamepad className="latest-button" onClick={() => { shouldScroll.current = true; if (log.current) log.current.scrollTop = log.current.scrollHeight; setNearBottom(true); }}>Últimas mensagens</button>}
              {proposalReview}
            </>}
            {workspaceView === 'Projetos' && (personalData ? <Projects snapshot={personalData} onRefresh={refreshPersonal} /> : unavailable('Projetos'))}
            {workspaceView === 'Tarefas' && (personalData ? <Tasks snapshot={personalData} now={clock} onRefresh={refreshPersonal} onPlan={() => void handleSend('Planeje meu dia')} /> : unavailable('Tarefas'))}
            {workspaceView === 'Memória' && (personalData ? <><PersonalMemory snapshot={personalData} onRefresh={refreshPersonal} onLogout={logout} /><button data-gamepad className="secondary-button" onClick={() => openKnowledge()}>Notas do Obsidian</button></> : unavailable('Memória pessoal'))}
          </div>
          <form className="jd-composer" onSubmit={submit}>
            <label className="jd-sr" htmlFor="message-input">Sua mensagem para JARVIS</label>
            <textarea data-gamepad ref={textarea} id="message-input" placeholder="Pergunte, planeje ou comece uma ideia…" autoComplete="off" wrap="off" rows={1} maxLength={MAX_MESSAGE_LENGTH} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSend(draft); } }} />
            <div className="jd-compose-bottom"><span><ModernIcon name="sparkles" />Seu próximo passo começa aqui</span><div>
              <button data-gamepad type="button" className="jd-mic" aria-label={microphoneLabel} aria-pressed={voice.phase === 'recording'} disabled={!(view === 'voice' ? voice.canRecognize : voice.canRecord) && !busy && voice.phase === 'idle'} title={view === 'voice' ? 'Conversar por voz; o navegador pode usar um serviço de reconhecimento.' : 'Gravar áudio e revisar a transcrição antes de enviar.'} onClick={microphone}>{voice.phase !== 'idle' || busy ? <Square size={16} /> : <ModernIcon name="mic" />}</button>
              <button data-gamepad type="submit" className="jd-send" aria-label="Enviar mensagem" disabled={!draft.trim() || pending || voice.phase !== 'idle'}><ModernIcon name="send" /></button>
            </div></div>
          </form>
          <div className="jd-disclosure">Histórico {personal ? 'na sua conta' : 'neste navegador'} · microfone ativado apenas com seu toque</div>
          {(error || voice.error || output.error) && <p className="jd-feedback inline-error" role="alert">{error || voice.error || output.error}</p>}
          {(notice || output.notice || interruptError) && <p className="jd-feedback">{interruptError || notice || output.notice}</p>}
          {voice.phase !== 'idle' && <p className="jd-feedback">{voice.phase === 'requesting' ? 'Aguardando permissão do microfone…' : voice.interim || spokenText || 'Ouvindo…'}</p>}
          {voice.audioUrl && <div className="jd-audio"><span>Seu áudio · apenas neste navegador</span><audio controls src={voice.audioUrl} aria-label="Reproduzir áudio gravado" /><button data-gamepad type="button" aria-label="Descartar gravação" onClick={voice.clearAudio}>Descartar</button></div>}
          {storageError && <p className="jd-feedback" role="alert">O navegador bloqueou o armazenamento ou ficou sem espaço. O histórico desta sessão pode não ser salvo.</p>}
        </div>
      </main>
    </div>
    {personalData && <Reception headless preferences={reception} greeting={greeting} enabled={searchEnabled} busy={pending || output.busy || readingParts || voice.phase !== 'idle' || !!modal} speechSupported={output.supported} onSpeak={() => { interrupt(''); void output.speak(greeting); }} onNews={() => handleSend(`pesquise últimas notícias sobre ${reception.topic.trim() || 'tecnologia'}`, 'briefing')} />}

    {modal && <Dialog key={modal} title={modal === 'help' ? 'O que o JARVIS pode fazer' : modal === 'settings' ? 'Seu assistente, do seu jeito' : modal === 'history' ? 'Histórico da conversa' : modal === 'memory' ? 'Memória pessoal' : modal === 'projects' ? 'Projetos e tarefas' : modal === 'knowledge' ? 'Notas do Obsidian' : 'Limpar esta conversa?'} onClose={closeModal}>
      {modal === 'projects' && personalData && <Projects snapshot={personalData} onRefresh={refreshPersonal} />}
      {modal === 'knowledge' && personalData && <Knowledge snapshot={personalData} onRefresh={refreshPersonal} initialNote={openedNote} />}
      {modal === 'help' && <><p className="modal-description">{model ? 'Faça perguntas e peça ajuda com textos e estudos. Para notas e cálculos, use os comandos abaixo.' : 'Os comandos abaixo já funcionam. A conversa com IA exige um backend e um modelo configurados em Preferências.'}</p><div className="command-list">{[['hora', 'Consultar o horário'], ['data', 'Ver a data de hoje'], ['calcular (12 + 8) / 2', 'Calcular uma expressão'], ['Últimas notícias de tecnologia', 'Consultar informações atuais'], ['anotar ', personal ? 'Guardar uma nota na sua conta' : BROWSER_MODE ? 'Guardar uma nota neste navegador' : 'Guardar uma nota no SQLite'], ...(personal ? [['lembre que ', 'Salvar uma preferência pessoal'], ['minhas memórias', 'Consultar memórias salvas'], ['meus projetos', 'Consultar seus projetos'], ['minhas notas do Obsidian', 'Listar notas importadas'], ['minhas tarefas', 'Consultar tarefas pendentes'], ['qual é meu nome', 'Consultar seu nome salvo'], ['corrija memória 1 para ', 'Corrigir uma memória'], ['esqueça memória 1', 'Apagar uma memória']] : []), ['notas', 'Ler suas notas'], ['apagar notas', 'Excluir todas as suas notas']].map(([command, label]) => <button data-gamepad key={command} disabled={pending || voice.phase !== 'idle'} onClick={() => { closeModal(); chooseCommand(command); }}><span><strong>{label}</strong><code>{command === 'anotar ' ? 'anotar comprar leite' : command}</code></span><ArrowRight size={17} /></button>)}</div><p className="privacy-note">{personal ? '“Apagar notas” remove as notas da conta. Limpar o histórico preserva notas e memórias.' : BROWSER_MODE ? '“Apagar notas” exclui as notas deste navegador. Limpar a conversa preserva as notas. Elas não são sincronizadas entre dispositivos.' : '“Apagar notas” exclui as notas da sua sessão. Elas ficam no servidor e não são removidas ao limpar a conversa. Não use este MVP para informações sensíveis em um servidor público.'}</p></>}
      {modal === 'memory' && personalData && <PersonalMemory snapshot={personalData} onRefresh={refreshPersonal} onLogout={logout} />}
      {modal === 'settings' && <><div className="jd-settings-actions"><button data-gamepad className="secondary-button" onClick={() => { changeView(view === 'voice' ? 'chat' : 'voice'); closeModal(); }}>{view === 'voice' ? 'Abrir modo chat' : 'Abrir modo voz'}</button><button data-gamepad className="secondary-button" onClick={() => setModal('history')}>Abrir histórico</button><button data-gamepad className="secondary-button" onClick={() => setModal('help')}>Comandos</button></div><label className="setting-row"><span><strong>Conversa contínua</strong><small>Volta a ouvir depois que uma resposta de voz termina. O microfone só começa após seu toque.</small></span><input data-gamepad type="checkbox" checked={continuous} disabled={!voice.canRecognize || view !== 'voice'} onChange={event => { continuousRef.current = event.target.checked; setContinuous(event.target.checked); if (!event.target.checked) sessionActive.current = false; }} /></label><label className="setting-row"><span><strong>Som no modo voz</strong><small>Reproduzir respostas ao conversar pelo microfone.</small></span><input data-gamepad type="checkbox" checked={voiceSound} disabled={!output.supported} onChange={event => { interrupt(''); soundRef.current = event.target.checked; setVoiceSound(event.target.checked); }} /></label><p className="privacy-note">{controller ? 'Controle detectado · A para ativar' : 'Tab para navegar · Enter para ativar'}</p><SearchStatus enabled={searchEnabled} />{receptionPanel}{personal && <button data-gamepad className="primary-button" onClick={() => setModal('memory')}>Memória pessoal</button>}<p className="modal-description">Texto sempre disponível. Áudio quando você escolher.</p>{!voice.canRecognize && <p className="support-note">Reconhecimento de voz indisponível neste navegador. {voice.canRecord ? 'Você pode gravar e ouvir o áudio no modo chat; envie seu pedido por texto.' : 'Continue pela digitação.'}</p>}<label className="setting-row"><span><strong>Ler respostas automaticamente no chat</strong><small>{output.supported ? 'Usa o tipo de voz escolhido abaixo.' : 'Síntese de voz indisponível neste navegador.'}</small></span><input data-gamepad type="checkbox" disabled={!output.supported} checked={autoVoice} onChange={event => { setAutoVoice(event.target.checked); if (!event.target.checked) { if (output.busy || readingParts) interrupt(''); else output.stop(); } }} /></label><SpeechSettings output={output} onChange={() => interrupt('')} /><label className="setting-row"><span><strong>Voz em partes</strong><small>Textos maiores usam até duas partes; a segunda é preparada enquanto a primeira toca. Mantém o limite de 1200 caracteres e pode consumir duas chamadas.</small></span><input data-gamepad type="checkbox" checked={fastVoice} onChange={event => { interrupt(''); setFastVoice(event.target.checked); }} /></label><label className="setting-row"><span><strong>Interromper dizendo “Jarvis, pare”</strong><small>Experimental. Só escuta durante uma resposta de conversa iniciada pelo microfone. Use fones para reduzir o eco. Não aceita perguntas durante a fala.</small></span><input data-gamepad type="checkbox" disabled={!voice.canRecognize} checked={voiceInterrupt} onChange={event => { interrupt(''); setVoiceInterrupt(event.target.checked); }} /></label>{personal && <ReceptionSettings value={reception} onChange={setReception} />}<ConversationTiming timing={timing} speech={output.timings} connectionMs={connectionMs} />{BROWSER_MODE ? <><AIConnection onChange={() => { interrupt(''); setBackendRevision(previous => previous + 1); }} /><p className="privacy-note">{modelStatus}</p></> : <p className="privacy-note">{modelStatus}. O modelo é configurado no servidor. Mensagens recentes acompanham perguntas à IA; a chave fica no backend.</p>}<div className="settings-detail"><ShieldCheck size={19} /><div><strong>{personal ? 'Histórico na sua conta' : 'Histórico no navegador'}</strong><p>{personal ? 'Mensagens, notas, memórias e projetos ficam no servidor e aparecem nos aparelhos conectados à sua conta. Memórias e seleções de notas, projetos e arquivos importados do Obsidian podem ser enviadas à IA junto com perguntas. Você pode apagá-las em Memória pessoal.' : BROWSER_MODE ? 'Histórico e notas ficam neste navegador. Notas e cálculos são processados aqui. Quando você conecta um backend, perguntas à IA enviam a mensagem e o contexto recente ao servidor e ao provedor. Pesquisas enviam o assunto ao buscador; trechos dos resultados podem acompanhar o resumo por IA. Até 100 mensagens e 100 notas são mantidas.' : 'Até 100 mensagens são salvas neste dispositivo. A conversa e o contexto recente são enviados ao backend para responder, e ao provedor quando usa IA. O backend não armazena as mensagens. Notas são persistidas em SQLite por sessão. Pesquisas enviam o assunto ao buscador e os trechos ao modelo para o resumo.'}</p></div></div><div className="settings-detail"><Mic size={19} /><div><strong>Você controla o microfone</strong><p>O microfone só é ativado após seu clique e permissão. No modo chat, o áudio gravado fica temporariamente neste navegador. No modo voz, apenas a transcrição entra no histórico. O reconhecimento de voz pode usar serviços externos do próprio navegador; confira sua política de privacidade.</p></div></div><div className="settings-detail"><Gamepad2 size={19} /><div><strong>Navegação acessível</strong><p>Use Tab e Shift + Tab, ou o direcional de um controle padrão. A ativa o item; B fecha esta janela. A digitação no Xbox depende do teclado virtual do Edge.</p></div></div><p className="privacy-note">Animações respeitam a preferência de movimento reduzido do sistema. O MVP não controla seu sistema operacional.</p></>}
      {modal === 'history' && <><p className="modal-description">{personal ? 'Suas conversas sincronizadas com a conta. Você pode continuar em outro aparelho.' : 'Suas conversas neste navegador. Você também pode continuar pelo modo chat.'}</p><div className="history-log" role="log" aria-label="Histórico de mensagens" tabIndex={0}>{messages.map(message => <article className={`message message-${message.role}`} key={message.id}><span className={`message-avatar ${message.role === 'assistant' ? 'jarvis-avatar' : ''}`} aria-hidden="true">{message.role === 'assistant' ? 'J' : 'U'}</span><div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'JARVIS' : 'Você'}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></div><p>{message.content}</p><SearchSources sources={message.sources} info={message.webSearch} />{personalData && <KnowledgeSources sources={message.knowledgeSources} onOpen={openKnowledge} />}</div></article>)}</div><div className="dialog-actions"><button data-gamepad className="secondary-button" onClick={() => setModal('clear')}>Limpar conversa</button><button data-gamepad className="primary-button" onClick={() => { closeModal(); changeView('chat'); }}>Abrir modo chat</button></div></>}
      {modal === 'clear' && <><p className="modal-description">{personal ? 'As mensagens serão removidas da conta e dos aparelhos na próxima sincronização.' : 'As mensagens serão removidas do histórico deste navegador.'} {BROWSER_MODE ? 'Suas notas neste navegador serão preservadas.' : 'Suas notas no servidor serão preservadas.'}</p><div className="dialog-actions"><button data-gamepad className="secondary-button" onClick={closeModal}>Cancelar</button><button data-gamepad className="primary-button" onClick={() => void clearConversation()}>Limpar conversa</button></div></>}
    </Dialog>}
  </div>;
}
