import { useState, type FormEvent } from 'react';
import type { PersonalSnapshot } from '../../shared/contracts';
import { personalRequest } from '../lib/personal';
import { HISTORY_KEY, loadHistory, loadSession } from '../lib/storage';

export function PersonalMemory({ snapshot, onRefresh, onLogout }: { snapshot: PersonalSnapshot; onRefresh: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [content, setContent] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false); const [imported, setImported] = useState(false);
  const act = async (operation: () => Promise<unknown>, refresh = true) => {
    if (busy) return; setBusy(true); setError('');
    try { await operation(); if (refresh) await onRefresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent) => { event.preventDefault(); if (content.trim()) void act(async () => { await personalRequest('memories', 'POST', { content: content.trim() }); setContent(''); }); };
  return <div className="personal-memory">
    <p className="modal-description">O JARVIS só salva preferências quando você pede. Estas memórias podem acompanhar perguntas ao provedor de IA. Evite senhas e segredos.</p>
    <p className="privacy-note">Apagar memórias preserva as conversas. Para remover também as referências do contexto recente, limpe o histórico.</p>
    <p className="privacy-note">{snapshot.storage === 'supabase' ? 'Dados guardados no seu Supabase e compartilhados entre os aparelhos.' : 'Dados guardados no SQLite deste servidor. No Render sem disco persistente, um deploy pode apagá-los.'}</p>
    <form onSubmit={save}><label htmlFor="memory-content">O que deseja que o JARVIS lembre?</label><textarea data-gamepad id="memory-content" maxLength={500} value={content} onChange={event => setContent(event.target.value)} placeholder="Prefiro respostas curtas em português" disabled={busy} /><button data-gamepad className="primary-button" disabled={busy || !content.trim()}>Guardar memória</button></form>
    <ul>{snapshot.memories.map(memory => <li key={memory.id}><p>{memory.content}</p><button data-gamepad className="secondary-button" disabled={busy} aria-label={`Apagar memória: ${memory.content}`} onClick={() => void act(() => personalRequest(`memories/${encodeURIComponent(memory.id)}`, 'DELETE'))}>Apagar</button></li>)}</ul>
    {!snapshot.memories.length && <p>Nenhuma memória salva. Você também pode dizer “lembre que prefiro respostas curtas”.</p>}
    {snapshot.memories.length > 0 && <button data-gamepad className="secondary-button" disabled={busy} onClick={() => setConfirm(!confirm)}>Apagar todas as memórias</button>}
    {confirm && <div className="dialog-actions"><span>Apagar todas as preferências salvas?</span><button data-gamepad className="primary-button" disabled={busy} onClick={() => void act(async () => { await personalRequest('memories', 'DELETE'); setConfirm(false); })}>Confirmar exclusão</button></div>}
    <div className="settings-detail"><div><strong>Trazer meu histórico antigo</strong><p>Importa até 100 mensagens deste navegador e as notas da antiga sessão que ainda existirem no servidor. Só este clique envia os dados antigos para sua conta.</p>
      <button data-gamepad className="secondary-button" disabled={busy || imported} onClick={() => void act(async () => {
        await personalRequest('import', 'POST', { messages: loadHistory().filter(message => message.content.length <= 6000), legacySessionId: loadSession() });
        localStorage.removeItem(HISTORY_KEY); setImported(true);
      })}>{imported ? 'Histórico importado' : 'Importar histórico deste navegador'}</button></div></div>
    {error && <p role="alert" className="personal-error">{error}</p>}
    <button data-gamepad className="secondary-button" disabled={busy} onClick={() => void act(onLogout, false)}>Sair da conta</button>
  </div>;
}
