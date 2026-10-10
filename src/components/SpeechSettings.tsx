import type { useSpeechOutput } from '../hooks/useVoice';
import { useEffect } from 'react';

export function SpeechSettings({ output }: { output: ReturnType<typeof useSpeechOutput> }) {
  useEffect(() => () => output.stop(), [output.stop]);
  return <div>
    <label className="voice-selection"><span>Tipo de voz</span>
      <select data-gamepad aria-label="Tipo de voz" value={output.engine} onChange={event => output.chooseEngine(event.target.value === 'browser' ? 'browser' : 'auto')}>
        <option value="auto">Automática · {output.cloudAvailable ? 'ElevenLabs' : 'voz do aparelho'}</option>
        <option value="browser">Voz do aparelho</option>
      </select>
      <small>{output.cloudAvailable
        ? 'ElevenLabs configurado no servidor. Antes de gerar áudio, o JARVIS verifica o plano Free e a cota disponível. Se o serviço falhar, tenta a voz do aparelho.'
        : 'Para uma voz mais natural, configure o ElevenLabs no servidor. Por enquanto, as respostas usam a voz do aparelho.'}</small>
    </label>
    <label className="voice-selection"><span>Voz do aparelho</span>
      <select data-gamepad aria-label="Voz do assistente" disabled={!output.voices.length} value={output.voiceUri} onChange={event => { output.stop(); output.chooseVoice(event.target.value); }}>
        <option value="">Automática · português quando disponível</option>
        {output.voices.map(item => <option key={item.voiceURI} value={item.voiceURI}>{item.name} ({item.lang})</option>)}
      </select>
      <small>Esta escolha é usada no modo aparelho e como alternativa. As vozes disponíveis mudam entre celular e computador.</small>
    </label>
    <button data-gamepad className="secondary-button speech-preview" disabled={!output.supported} onClick={() => {
      if (output.busy) output.stop();
      else void output.speak('Olá. Sou o Jarvis. Estou aqui para conversar, pesquisar e ajudar você a organizar o seu dia. Como posso ajudar?');
    }}>{output.busy ? 'Parar teste de voz' : 'Testar voz'}</button>
    {output.error && <p className="inline-error" role="alert">{output.error}</p>}
    {output.notice && <p className="support-note">{output.notice}</p>}
    <p className="privacy-note">Na voz por IA, o texto a ser lido é enviado ao ElevenLabs. Leituras têm até 1.200 caracteres; a resposta completa permanece na tela. O áudio fica temporariamente na memória deste aparelho.</p>
  </div>;
}
