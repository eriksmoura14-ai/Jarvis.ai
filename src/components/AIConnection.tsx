import { useEffect, useRef, useState, type FormEvent } from 'react';
import { checkBackend } from '../lib/api';
import { loadBackend, normalizeBackend, saveBackend } from '../lib/backend';

export function AIConnection({ onChange }: { onChange: () => void }) {
  const [address, setAddress] = useState(loadBackend);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { const current = request.current; request.current = null; current?.abort(); }, []);
  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (checking) return;
    const current = new AbortController();
    request.current = current;
    const timeout = setTimeout(() => current.abort(), 5000);
    setChecking(true); setError(''); setConnected(false);
    try {
      const endpoint = normalizeBackend(address);
      if (!endpoint) throw new Error('Informe o endereço do backend.');
      const health = await checkBackend(endpoint, current.signal);
      if (!health.ai?.configured) throw new Error('O backend respondeu, mas ainda não tem um modelo configurado. Defina AI_PROVIDER e AI_MODEL no servidor.');
      if (current.signal.aborted) return;
      saveBackend(endpoint); setAddress(endpoint); setConnected(true); onChange();
    } catch (cause) {
      if (request.current !== current) return;
      if (current.signal.aborted) setError('A conexão não respondeu a tempo. Confira o endereço e o backend.');
      else setError(cause instanceof TypeError ? 'Não foi possível conectar. Confira HTTPS, disponibilidade e ALLOWED_ORIGINS no backend.' : cause instanceof Error ? cause.message : 'Não foi possível conectar.');
    } finally { clearTimeout(timeout); if (request.current === current) { setChecking(false); request.current = null; } }
  };
  return <section className="ai-connection" aria-labelledby="ai-connection-title">
    <h3 id="ai-connection-title">Conversa com IA</h3>
    <p>Conecte um backend JARVIS com modelo configurado. Sua mensagem e até 10 mensagens recentes serão enviadas a ele e ao provedor. Notas e cálculos continuam neste navegador.</p>
    <form onSubmit={event => void connect(event)}>
      <label htmlFor="backend-address">Endereço do backend</label>
      <input data-gamepad id="backend-address" type="url" inputMode="url" autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="https://seu-backend.example" value={address} onChange={event => { setAddress(event.target.value); setConnected(false); }} disabled={checking} />
      <div className="dialog-actions"><button data-gamepad type="submit" className="primary-button" disabled={checking || !address.trim()}>{checking ? 'Verificando…' : 'Conectar IA'}</button><button data-gamepad type="button" className="secondary-button" onClick={() => {
        const current = request.current; request.current = null; current?.abort(); setChecking(false);
        try { saveBackend(''); setAddress(''); setConnected(false); setError(''); onChange(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível desconectar.'); }
      }}>Usar somente comandos locais</button></div>
    </form>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {connected && <p className="ai-connection-success" role="status">Backend verificado e endereço salvo. A chave do modelo permanece no servidor.</p>}
    <small>Informe somente o endereço. Nunca coloque chaves de API aqui. Verificar o backend não testa a chave nem a disponibilidade do modelo.</small>
  </section>;
}
