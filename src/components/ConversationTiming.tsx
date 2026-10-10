import type { ChatTimings } from '../../shared/contracts';

export interface TurnTiming { requestMs?: number; readyMs?: number; firstTextMs?: number; firstAudioMs?: number; recognitionMs?: number; server?: ChatTimings }
export function ConversationTiming({ timing, speech, connectionMs }: { timing?: TurnTiming; speech?: { prepareMs?: number; firstAudioMs: number; engine: string }; connectionMs?: number }) {
  const seconds = (ms: number | undefined) => ms === undefined ? '—' : `${(ms / 1000).toFixed(2)} s`;
  return <section className="conversation-timing" aria-label="Tempos da conversa">
    <h3>Tempos da conversa</h3>
    <dl><div><dt>Última verificação da conexão</dt><dd>{seconds(connectionMs)}</dd></div>
      <div><dt>Captura e reconhecimento</dt><dd>{seconds(timing?.recognitionMs)}</dd></div>
      <div><dt>Conexão e autenticação do pedido</dt><dd>{seconds(timing?.readyMs)}</dd></div>
      <div><dt>Primeiro texto na tela</dt><dd>{seconds(timing?.firstTextMs)}</dd></div>
      <div><dt>Resposta completa recebida</dt><dd>{seconds(timing?.requestMs)}</dd></div>
      <div><dt>Preparação no servidor</dt><dd>{seconds(timing?.server?.preparationMs)}</dd></div>
      <div><dt>IA, busca ou comando</dt><dd>{seconds(timing?.server?.answerMs)}</dd></div>
      <div><dt>Salvar conversa</dt><dd>{seconds(timing?.server?.saveMs)}</dd></div>
      <div><dt>Primeira voz desde o envio</dt><dd>{seconds(timing?.firstAudioMs)}</dd></div>
      <div><dt>Preparar o último MP3</dt><dd>{seconds(speech?.prepareMs)}</dd></div>
      <div><dt>Último áudio · {speech?.engine ?? 'sem leitura'}</dt><dd>{seconds(speech?.firstAudioMs)}</dd></div>
    </dl><p className="privacy-note">Medições deste aparelho, sem enviar telemetria. O reconhecimento inclui o tempo em que você fala; conexão inclui rede e autenticação. Uma demora na conexão pode vir do despertar do Render gratuito, mas esta medição não identifica a causa sozinha.</p>
  </section>;
}
