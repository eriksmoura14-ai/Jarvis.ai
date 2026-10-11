import { useEffect, useRef, useState } from 'react';
import type { SpeechQuota as Quota } from '../../shared/speech';
import { speechQuota, SpeechRequestError } from '../lib/speech';

export function SpeechQuota() {
  const [quota, setQuota] = useState<Quota>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  const check = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 25_000);
    setBusy(true); setError(''); setQuota(undefined);
    try { const data = await speechQuota(controller.signal); if (request.current === controller) setQuota(data); }
    catch (cause) { if (request.current === controller) setError(controller.signal.aborted ? 'A consulta demorou para responder. Tente novamente.' : cause instanceof SpeechRequestError ? cause.message : 'Não foi possível consultar a cota.'); }
    finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <div className="voice-selection">
    <button data-gamepad className="secondary-button" disabled={busy} onClick={() => void check()}>{busy ? 'Consultando cota…' : 'Consultar cota de voz'}</button>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {quota && <div role="status" className="support-note">
      <p>Saldo da conta: {quota.remaining.toLocaleString('pt-BR')} de {quota.limit.toLocaleString('pt-BR')} caracteres disponíveis.</p>
      {!quota.remaining && <p>Cota da conta esgotada. Use a voz do aparelho enquanto aguarda a renovação.</p>}
      {quota.nextResetAt && <p>Renovação informada pelo ElevenLabs: {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(quota.nextResetAt))}.</p>}
      <p>A chave pode ter um limite menor que o saldo da conta. Um texto maior que o saldo restante também impede a leitura. Confira o limite da chave no ElevenLabs se o erro continuar. Trocar de voz ou recarregar não repõe créditos.</p>
    </div>}
    <small>Consulta o saldo da conta sem gerar áudio ou consumir créditos de voz. Limites da chave e limites temporários de requisições são separados.</small>
  </div>;
}
