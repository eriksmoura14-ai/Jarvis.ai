import { useEffect, useState } from 'react';
import type { ObsidianDevice } from '../../shared/obsidian';
import { personalRequest } from '../lib/personal';
export function ObsidianConnection() {
  const [devices, setDevices] = useState<ObsidianDevice[]>([]); const [name, setName] = useState('Meu Android');
  const [token, setToken] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [revoking, setRevoking] = useState<string>();
  const refresh = async () => { const result = await personalRequest<{ devices: ObsidianDevice[] }>('obsidian/devices'); setDevices(result.devices); };
  useEffect(() => { const controller = new AbortController(); void personalRequest<{ devices: ObsidianDevice[] }>('obsidian/devices', 'GET', undefined, controller.signal).then(result => { if (!controller.signal.aborted) setDevices(result.devices); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar as chaves.'); }); return () => controller.abort(); }, []);
  const create = async () => {
    if (busy || !name.trim()) return; setBusy(true); setError(''); setToken('');
    try { const result = await personalRequest<{ token: string; device: ObsidianDevice }>('obsidian/devices', 'POST', { name: name.trim() }); setToken(result.token); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível vincular.'); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try { await personalRequest(`obsidian/devices/${encodeURIComponent(id)}`, 'DELETE'); setRevoking(undefined); setToken(''); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível revogar.'); }
    finally { setBusy(false); }
  };
  return <details className="knowledge-connection"><summary data-gamepad>Conectar Obsidian do Android</summary>
    <p>O plugin acompanha as notas enquanto o Obsidian estiver aberto. Só criar uma chave aqui não ativa a conexão no celular.</p>
    <ol><li><a data-gamepad href="/downloads/jarvis-obsidian.zip" download>Baixar plugin JARVIS para Obsidian (.zip)</a>. Extraia a pasta <code>jarvis-obsidian</code> dentro de <code>.obsidian/plugins</code> no seu cofre. No gerenciador de arquivos do Android, habilite a exibição de arquivos ocultos.</li><li>No Obsidian, abra Configurações → Plugins da comunidade, permita plugins e ative “JARVIS — Cofre pessoal”. Reinicie o Obsidian se não aparecer. Este plugin é instalado manualmente; ainda não está no catálogo.</li><li>Gere a chave abaixo e cole somente nas configurações desse plugin, junto do endereço <code>{window.location.origin}</code>. Escolha a pasta e ative a sincronização.</li><li>Para receber no cofre as edições feitas pelo Xbox ou computador, ative “Receber alterações do JARVIS” no plugin. Comece testando uma nota sem dados sensíveis.</li></ol>
    <label htmlFor="obsidian-device-name">Nome do aparelho</label><input data-gamepad id="obsidian-device-name" value={name} maxLength={60} disabled={busy} onChange={event => setName(event.target.value)} />
    <button data-gamepad className="secondary-button" disabled={busy || !name.trim() || devices.length >= 5} onClick={() => void create()}>Gerar chave de vinculação</button>
    {token && <div role="group" aria-label="Chave de vinculação"><p>Copie agora: esta chave só aparece nesta tela. Autoriza leitura e atualização da biblioteca de notas; expira em 180 dias. Não envie no chat nem compartilhe.</p><label htmlFor="obsidian-pair-token">Chave para o plugin</label><input data-gamepad id="obsidian-pair-token" readOnly value={token} autoComplete="off" spellCheck={false} onFocus={event => event.target.select()} /><button data-gamepad className="secondary-button" onClick={() => setToken('')}>Ocultar chave</button></div>}
    <p>Chaves autorizadas ({devices.length}/5). Esta lista não indica se o Obsidian está aberto ou conectado.</p>
    <ul>{devices.map(device => <li key={device.id}>{device.name} · válida até {new Date(device.expires).toLocaleDateString('pt-BR')} <button data-gamepad className="secondary-button" disabled={busy} onClick={() => setRevoking(device.id)}>Revogar {device.name}</button>{revoking === device.id && <div><p>Revogar interrompe o acesso deste plugin; notas nos dois lados são preservadas.</p><button data-gamepad className="secondary-button" disabled={busy} onClick={() => setRevoking(undefined)}>Cancelar</button><button data-gamepad className="primary-button" disabled={busy} onClick={() => void revoke(device.id)}>Confirmar revogação</button></div>}</li>)}</ul>
    <p className="privacy-note">Até 100 notas/1 MB, sem anexos. Mudanças nos dois lados geram conflitos para revisão no plugin. Exclusões e renomeações não são propagadas automaticamente. Backups locais ficam em .jarvis-backups antes de sobrescrever um arquivo.</p>
    {error && <p role="alert" className="personal-error">{error}</p>}
  </details>;
}
