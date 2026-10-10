import { useEffect, useState, type FormEvent } from 'react';
import type { PersonalSnapshot } from '../../shared/contracts';
import { personalRequest } from '../lib/personal';
import { HISTORY_KEY, loadHistory, loadSession } from '../lib/storage';
import { personalProfile } from '../../shared/memory';

export function PersonalMemory({ snapshot, onRefresh, onLogout }: { snapshot: PersonalSnapshot; onRefresh: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [content, setContent] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false); const [imported, setImported] = useState(false);
  const [name, setName] = useState(() => personalProfile(snapshot.memories).name);
  const [address, setAddress] = useState(() => personalProfile(snapshot.memories).address);
  const [profileDirty, setProfileDirty] = useState(false);
  const [baseline, setBaseline] = useState(() => personalProfile(snapshot.memories));
  const [editing, setEditing] = useState<{ id: string; content: string; previousContent: string }>();
  useEffect(() => {
    if (profileDirty) return;
    const profile = personalProfile(snapshot.memories);
    setName(profile.name); setAddress(profile.address); setBaseline(profile);
  }, [snapshot.memories, profileDirty]);
  const act = async (operation: () => Promise<unknown>, refresh = true) => {
    if (busy) return; setBusy(true); setError('');
    try { await operation(); if (refresh) await onRefresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent) => { event.preventDefault(); if (content.trim()) void act(async () => { await personalRequest('memories', 'POST', { content: content.trim() }); setContent(''); }); };
  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await personalRequest('profile', 'PUT', { name: name.trim(), address: address.trim(), previousName: baseline.name, previousAddress: baseline.address });
      setProfileDirty(false);
    });
  };
  return <div className="personal-memory">
    <p className="modal-description">O JARVIS guarda informações quando você pede ou salva neste painel. Estas memórias podem acompanhar perguntas ao provedor de IA. Evite senhas e segredos.</p>
    <p className="privacy-note">Corrigir ou apagar informações reinicia o contexto enviado à IA. As conversas antigas continuam visíveis; use Limpar conversa para removê-las do histórico.</p>
    <p className="privacy-note">{snapshot.storage === 'supabase' ? 'Dados guardados no seu Supabase e compartilhados entre os aparelhos.' : 'Dados guardados no SQLite deste servidor. No Render sem disco persistente, um deploy pode apagá-los.'}</p>
    <form onSubmit={saveProfile} aria-label="Perfil pessoal">
      <label htmlFor="personal-name">Seu nome</label><input data-gamepad id="personal-name" maxLength={80} value={name} placeholder="Como você se chama?" disabled={busy} onChange={event => { setName(event.target.value); setProfileDirty(true); }} />
      <label htmlFor="personal-address">Como o JARVIS deve chamar você?</label><input data-gamepad id="personal-address" maxLength={80} value={address} placeholder="Senhor, seu nome ou apelido" disabled={busy} onChange={event => { setAddress(event.target.value); setProfileDirty(true); }} />
      <p className="privacy-note">O perfil usa até duas das 30 memórias. Deixe um campo vazio para apagar essa informação.</p>
      <div className="memory-actions"><button data-gamepad className="primary-button" disabled={busy || !profileDirty}>Salvar perfil</button>{profileDirty && <button data-gamepad type="button" className="secondary-button" disabled={busy} onClick={() => setProfileDirty(false)}>Descartar alterações</button>}</div>
    </form>
    <form onSubmit={save}><label htmlFor="memory-content">O que deseja que o JARVIS lembre?</label><textarea data-gamepad id="memory-content" maxLength={500} value={content} onChange={event => setContent(event.target.value)} placeholder="Prefiro respostas curtas em português" disabled={busy} /><button data-gamepad className="primary-button" disabled={busy || !content.trim()}>Guardar memória</button></form>
    <ul>{snapshot.memories.map((memory, index) => <li key={memory.id}>{editing?.id === memory.id ? <form aria-label={`Editar memória ${index + 1}`} onSubmit={event => {
      event.preventDefault(); void act(async () => { await personalRequest(`memories/${encodeURIComponent(memory.id)}`, 'PATCH', { content: editing.content.trim(), previousContent: editing.previousContent }); setEditing(undefined); });
    }}><label htmlFor="memory-edit">Editar informação</label><textarea data-gamepad id="memory-edit" maxLength={500} value={editing.content} disabled={busy} onChange={event => setEditing({ ...editing, content: event.target.value })} /><div className="memory-actions"><button data-gamepad className="primary-button" disabled={busy || !editing.content.trim()}>Salvar alteração</button><button data-gamepad type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(undefined)}>Cancelar edição</button></div></form> : <><p><span aria-hidden="true">{index + 1}. </span><span>{memory.content}</span></p><div className="memory-actions"><button data-gamepad className="secondary-button" disabled={busy} aria-label={`Editar memória: ${memory.content}`} onClick={() => { setEditing({ id: memory.id, content: memory.content, previousContent: memory.content }); setError(''); }}>Editar</button><button data-gamepad className="secondary-button" disabled={busy} aria-label={`Apagar memória: ${memory.content}`} onClick={() => void act(() => personalRequest(`memories/${encodeURIComponent(memory.id)}`, 'DELETE'))}>Apagar</button></div></>}</li>)}</ul>
    {!snapshot.memories.length && <p>Nenhuma memória salva. Você também pode dizer “lembre que prefiro respostas curtas”.</p>}
    {snapshot.memories.length > 0 && <button data-gamepad className="secondary-button" disabled={busy} onClick={() => setConfirm(!confirm)}>Apagar todas as memórias</button>}
    {confirm && <div className="dialog-actions"><span>Apagar todas as preferências salvas?</span><button data-gamepad className="primary-button" disabled={busy} onClick={() => void act(async () => { await personalRequest('memories', 'DELETE'); setConfirm(false); })}>Confirmar exclusão</button></div>}
    <details><summary data-gamepad>Minhas notas ({snapshot.notes.length})</summary><ul>{snapshot.notes.map((note, index) => <li key={index}><p>{index + 1}. {note.content}</p></li>)}</ul></details>
    <div className="settings-detail"><div><strong>Trazer meu histórico antigo</strong><p>Importa até 100 mensagens deste navegador e as notas da antiga sessão que ainda existirem no servidor. Só este clique envia os dados antigos para sua conta.</p>
      <button data-gamepad className="secondary-button" disabled={busy || imported} onClick={() => void act(async () => {
        await personalRequest('import', 'POST', { messages: loadHistory().filter(message => message.content.length <= 6000), legacySessionId: loadSession() });
        localStorage.removeItem(HISTORY_KEY); setImported(true);
      })}>{imported ? 'Histórico importado' : 'Importar histórico deste navegador'}</button></div></div>
    {error && <p role="alert" className="personal-error">{error}</p>}
    <button data-gamepad className="secondary-button" disabled={busy} onClick={() => void act(onLogout, false)}>Sair da conta</button>
  </div>;
}
