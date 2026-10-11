import type { useSpeechOutput } from '../hooks/useVoice';
import { useEffect, useState } from 'react';
import { BrazilianVoicePicker } from './BrazilianVoicePicker';
import { SpeechQuota } from './SpeechQuota';

const preview = 'Olá. Sou o Jarvis. Estou aqui para conversar, pesquisar e ajudar você a organizar o seu dia. Como posso ajudar?';

export function SpeechSettings({ output, onChange }: { output: ReturnType<typeof useSpeechOutput>; onChange: () => void }) {
  const [voiceId, setVoiceId] = useState(output.cloudVoiceId);
  const sample = output.profile === 'british' ? 'Good morning, sir. All systems are ready. How may I assist you today?'
    : output.profile === 'jarvis-br' ? 'Bom dia, senhor. Sou o Jarvis. Estou pronto para ajudar. Qual é a nossa prioridade hoje?' : preview;
  useEffect(() => () => output.stop(), [output.stop]);
  return <div>
    <label className="voice-selection"><span>Tipo de voz</span>
      <select data-gamepad aria-label="Tipo de voz" value={output.engine} onChange={event => { onChange(); output.chooseEngine(event.target.value === 'browser' ? 'browser' : event.target.value === 'elevenlabs' ? 'elevenlabs' : 'auto'); }}>
        <option value="elevenlabs" disabled={!output.cloudAvailable}>ElevenLabs · voz natural</option>
        <option value="auto">Automática · {output.cloudAvailable ? 'ElevenLabs' : 'voz do aparelho'}</option>
        <option value="browser">Voz do aparelho</option>
      </select>
      <small>{output.cloudAvailable
        ? 'No modo ElevenLabs, uma falha aparece na tela e a leitura para. O modo Automática permite usar a voz do aparelho como alternativa. O JARVIS verifica o plano Free e a cota antes de gerar áudio.'
        : 'Para uma voz mais natural, configure o ElevenLabs no servidor. Por enquanto, as respostas usam a voz do aparelho.'}</small>
    </label>
    {output.cloudAvailable && <SpeechQuota />}
    {output.nativeAvailable && <button data-gamepad className="secondary-button speech-preview" onClick={() => { onChange(); output.chooseEngine('browser'); }}>Usar voz do aparelho · sem cota ElevenLabs</button>}
    <label className="voice-selection"><span>Estilo de fala</span>
      <select data-gamepad aria-label="Estilo de fala" value={output.profile} onChange={event => { onChange(); output.chooseProfile(event.target.value === 'natural' ? 'natural' : event.target.value === 'british' ? 'british' : 'jarvis-br'); }}>
        <option value="jarvis-br">JARVIS · português brasileiro, calmo e preciso</option>
        <option value="british">Britânico · calmo e preciso</option>
        <option value="natural">Natural · português</option>
      </select>
      <small>O estilo JARVIS usa um teste em português com “senhor”, maior estabilidade e fala contida. O timbre depende da voz escolhida; o perfil não garante a voz do filme. As respostas continuam no idioma da conversa. Trocar a voz ou o estilo interrompe a conversa atual.</small>
    </label>
    {output.cloudAvailable && <div className="voice-selection">
      <label htmlFor="cloud-voice-id">Voice ID do ElevenLabs</label>
      <input data-gamepad id="cloud-voice-id" type="text" autoComplete="off" maxLength={100} placeholder="Vazio usa a voz configurada no servidor" value={voiceId} onChange={event => setVoiceId(event.target.value)} />
      <button data-gamepad className="secondary-button" onClick={() => { if (output.chooseCloudVoice(voiceId)) onChange(); }}>Salvar voz</button>
      <small>Escolha uma voz na <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noreferrer">biblioteca do ElevenLabs</a> e copie seu Voice ID, ou use a busca abaixo. Não cole a chave API. A disponibilidade no plano Free é verificada ao testar. Esta preferência vale neste navegador; o ID do servidor vale nos demais aparelhos.</small>
    </div>}
    {output.cloudAvailable && <BrazilianVoicePicker onChoose={id => {
      onChange(); output.chooseProfile('jarvis-br'); output.chooseCloudVoice(id); output.chooseEngine('elevenlabs'); setVoiceId(id);
    }} />}
    <label className="voice-selection"><span>Voz do aparelho</span>
      <select data-gamepad aria-label="Voz do assistente" disabled={!output.voices.length} value={output.voiceUri} onChange={event => { onChange(); output.stop(); output.chooseVoice(event.target.value); }}>
        <option value="">Automática · {output.profile === 'british' ? 'britânico quando disponível' : 'português quando disponível'}</option>
        {output.voices.map(item => <option key={item.voiceURI} value={item.voiceURI}>{item.name} ({item.lang})</option>)}
      </select>
      <small>Esta escolha é usada no modo aparelho e como alternativa. As vozes disponíveis mudam entre celular e computador.</small>
    </label>
    <div className="speech-preview-controls"><button data-gamepad className="secondary-button speech-preview" disabled={!output.supported} onClick={() => {
      onChange();
      if (output.busy) output.stop();
      else void output.speak(sample);
    }}>{output.busy ? 'Parar teste de voz' : 'Testar voz'}</button>
    {output.cloudAvailable && <button data-gamepad className="primary-button speech-preview" disabled={output.busy} onClick={() => {
      onChange();
      output.chooseEngine('elevenlabs');
      void output.speak(sample, 'elevenlabs');
    }}>Testar ElevenLabs</button>}</div>
    {output.error && <p className="inline-error" role="alert">{output.error}</p>}
    {output.notice && <p className="support-note">{output.notice}</p>}
    <p className="privacy-note">Na voz por IA, o texto a ser lido é enviado ao ElevenLabs. Leituras têm até 1.200 caracteres; a resposta completa permanece na tela. O áudio fica temporariamente na memória deste aparelho.</p>
  </div>;
}
