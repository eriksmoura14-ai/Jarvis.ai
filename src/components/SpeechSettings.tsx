import type { useSpeechOutput } from '../hooks/useVoice';
import { useEffect } from 'react';

const preview = 'Olá. Sou o Jarvis. Estou aqui para conversar, pesquisar e ajudar você a organizar o seu dia. Como posso ajudar?';

export function SpeechSettings({ output }: { output: ReturnType<typeof useSpeechOutput> }) {
  useEffect(() => () => output.stop(), [output.stop]);
  return <div>
    <label className="voice-selection"><span>Tipo de voz</span>
      <select data-gamepad aria-label="Tipo de voz" value={output.engine} onChange={event => output.chooseEngine(event.target.value === 'browser' ? 'browser' : event.target.value === 'elevenlabs' ? 'elevenlabs' : 'auto')}>
        <option value="elevenlabs" disabled={!output.cloudAvailable}>ElevenLabs · voz natural</option>
        <option value="auto">Automática · {output.cloudAvailable ? 'ElevenLabs' : 'voz do aparelho'}</option>
        <option value="browser">Voz do aparelho</option>
      </select>
      <small>{output.cloudAvailable
        ? 'No modo ElevenLabs, uma falha aparece na tela e a leitura para. O modo Automática permite usar a voz do aparelho como alternativa. O JARVIS verifica o plano Free e a cota antes de gerar áudio.'
        : 'Para uma voz mais natural, configure o ElevenLabs no servidor. Por enquanto, as respostas usam a voz do aparelho.'}</small>
    </label>
    <label className="voice-selection"><span>Voz do aparelho</span>
      <select data-gamepad aria-label="Voz do assistente" disabled={!output.voices.length} value={output.voiceUri} onChange={event => { output.stop(); output.chooseVoice(event.target.value); }}>
        <option value="">Automática · português quando disponível</option>
        {output.voices.map(item => <option key={item.voiceURI} value={item.voiceURI}>{item.name} ({item.lang})</option>)}
      </select>
      <small>Esta escolha é usada no modo aparelho e como alternativa. As vozes disponíveis mudam entre celular e computador.</small>
    </label>
    <div className="speech-preview-controls"><button data-gamepad className="secondary-button speech-preview" disabled={!output.supported} onClick={() => {
      if (output.busy) output.stop();
      else void output.speak(preview);
    }}>{output.busy ? 'Parar teste de voz' : 'Testar voz'}</button>
    {output.cloudAvailable && <button data-gamepad className="primary-button speech-preview" disabled={output.busy} onClick={() => {
      output.chooseEngine('elevenlabs');
      void output.speak(preview, 'elevenlabs');
    }}>Testar ElevenLabs</button>}</div>
    {output.error && <p className="inline-error" role="alert">{output.error}</p>}
    {output.notice && <p className="support-note">{output.notice}</p>}
    <p className="privacy-note">Na voz por IA, o texto a ser lido é enviado ao ElevenLabs. Leituras têm até 1.200 caracteres; a resposta completa permanece na tela. O áudio fica temporariamente na memória deste aparelho.</p>
  </div>;
}
