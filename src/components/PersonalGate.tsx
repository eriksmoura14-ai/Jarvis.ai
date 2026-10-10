import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LockKeyhole, RefreshCw } from 'lucide-react';
import App from '../App';
import { Core } from './Core';
import { BROWSER_MODE } from '../lib/api';
import { personalRequest, personalSession, personalSnapshot } from '../lib/personal';
import type { PersonalSnapshot } from '../../shared/contracts';
import { useGamepad } from '../hooks/useGamepad';

function LoginNavigation() { useGamepad(); return null; }

export function PersonalGate() {
  const [state, setState] = useState<'checking' | 'disabled' | 'locked' | 'ready' | 'error'>(BROWSER_MODE ? 'disabled' : 'checking');
  const [snapshot, setSnapshot] = useState<PersonalSnapshot>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useCallback(() => { setState('locked'); setSnapshot(undefined); setPassword(''); }, []);
  const verify = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const session = await personalSession(signal);
      if (signal?.aborted) return;
      if (!session.enabled) { setState('disabled'); return; }
      if (!session.authenticated) { lock(); return; }
      const data = await personalSnapshot(signal);
      if (!signal?.aborted) { setSnapshot(data); setState('ready'); }
    } catch (cause) { if (!signal?.aborted) { setError(cause instanceof Error ? cause.message : 'Sem conexão com o JARVIS.'); setState('error'); } }
  }, [lock]);
  useEffect(() => {
    if (BROWSER_MODE) return;
    const controller = new AbortController(); void verify(controller.signal);
    window.addEventListener('jarvis-lock', lock);
    return () => { controller.abort(); window.removeEventListener('jarvis-lock', lock); };
  }, [verify, lock]);
  const login = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await personalRequest('login', 'POST', { password }); setPassword(''); await verify(); }
    catch (cause) { setPassword(''); setError(cause instanceof Error ? cause.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };
  if (state === 'disabled') return <App />;
  if (state === 'ready' && snapshot) return <App personal={snapshot} onLock={lock} />;
  return <main className="personal-gate"><LoginNavigation /><div className="personal-login">
    <Core state={busy || state === 'checking' ? 'thinking' : 'idle'} />
    <span className="eyebrow">JARVIS · ACESSO PESSOAL</span><h1>Seu assistente. Sua memória.</h1>
    {state === 'locked' ? <form onSubmit={event => void login(event)}>
      <label htmlFor="personal-password"><LockKeyhole size={18} /> Senha pessoal</label>
      <input data-gamepad id="personal-password" type="password" autoComplete="current-password" maxLength={200} required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
      <button data-gamepad className="primary-button" disabled={busy}>{busy ? 'Entrando…' : 'Entrar no JARVIS'}</button>
      <p>Use a mesma senha no computador e no celular.</p>
    </form> : state === 'checking' ? <p role="status">Verificando seu acesso…</p> : <button data-gamepad className="secondary-button" onClick={() => { setState('checking'); void verify(); }}><RefreshCw size={16} /> Tentar novamente</button>}
    {error && <p role="alert" className="personal-error">{error}</p>}
  </div></main>;
}
