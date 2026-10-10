# Voz natural no JARVIS

A voz padrão usa a síntese do navegador. A integração opcional com ElevenLabs
gera MP3 no backend e reproduz no computador ou celular. Não muda o modelo de
conversa, o reconhecimento do microfone nem as memórias.

## Ativar na sua conta

1. Abra [ElevenLabs](https://elevenlabs.io/app) e confirme que sua conta está no
   plano **Free**. Escolha uma voz disponível nesse plano e teste uma frase em
   português. Copie o **Voice ID** pelo menu da voz. Não é o nome da voz nem o
   endereço da página. Não é necessário clonar uma voz.
2. Na seção de desenvolvedor/API Keys da conta, crie uma chave para o JARVIS.
   Ela precisa permitir **Text to Speech** e leitura dos dados da conta
   (**User**, para consultar plano/cota). Defina um limite de créditos na chave
   se essa opção estiver disponível. Não habilite cobrança por uso excedente
   nem contrate um plano para usar esta integração.
3. No [Render → Environment](https://dashboard.render.com/web/srv-db4o3rl9fdbs73a9haa0/env),
   mantenha as variáveis atuais e acrescente as três juntas:

   | Nome | Valor |
   | --- | --- |
   | `TTS_PROVIDER` | `elevenlabs` |
   | `ELEVENLABS_API_KEY` | Sua chave criada no ElevenLabs |
   | `ELEVENLABS_VOICE_ID` | O identificador da voz escolhida |

   O modo pessoal com `JARVIS_PASSWORD` é obrigatório. Não envie a chave pelo
   chat, não coloque em variáveis `VITE_`, não salve no código ou no GitHub.
   As configurações de Groq e Supabase permanecem independentes.
4. Salve as variáveis e aguarde o deploy. Atualize
   [o JARVIS no Render](https://jarvis-ai-dwqp.onrender.com/), entre com sua senha
   e abra **Preferências → Tipo de voz → Automática → Testar voz**.
   A indicação de configuração significa que as variáveis foram lidas;
   somente a reprodução bem-sucedida confirma a chave, a voz e o acesso real.

Para desativar no servidor, use `TTS_PROVIDER=browser`. Para usar somente a voz
do aparelho sem alterar o servidor, selecione **Voz do aparelho** em Preferências.
Essa escolha e a voz nativa escolhida são guardadas por navegador/dispositivo.
O Voice ID do servidor vale para todos os aparelhos; atualize a página depois
de trocar esse ID para descartar o áudio anterior.

## Como funciona e limites

- A rota autenticada `POST /api/speech` aceita apenas texto, até 1.200 caracteres.
  Não recebe chaves, URL, modelo ou identificador de voz do frontend.
- O backend consulta `GET /v1/user/subscription` antes de cada geração. Só aceita
  `tier=free`, contagens válidas e cota suficiente. Contas pagas, planos
  desconhecidos e falhas nessa verificação não geram áudio. A cota é a que a
  API informar para sua conta; não há promessa de uso ilimitado nem de uma
  quantidade fixa gratuita. A aplicação não altera planos ou faturamento.
- Usa `eleven_multilingual_v2`, que permite fala em português, e MP3 a 128 kb/s.
  A naturalidade e o sotaque dependem da voz escolhida. A API pode impor limites
  ou exigir que a voz esteja disponível na sua conta.
- Há uma geração simultânea por instância do servidor, até 10 tentativas por
  minuto/IP, timeout de 20 segundos e resposta limitada a 4 MB. Contagem na API
  é compartilhada com outros usos da conta; o ElevenLabs também aplica sua cota.
- Markdown, links e referências de pesquisa são retirados da leitura. Respostas
  longas recebem um aviso falado de que o texto completo está na tela.
- O **texto a ser lido** é enviado ao ElevenLabs; o microfone não é enviado para
  essa integração. Consulte a política de retenção da sua conta. O JARVIS não
  salva MP3 no Supabase, em disco ou no localStorage. Conserva somente o último
  áudio na memória da página para repetir sem nova geração. Sair da conta ou
  recarregar a página descarta esse áudio. Repetir outra resposta pode gerar
  áudio e consumir cota novamente.
- Falha do provedor ou cota esgotada tenta a síntese nativa e informa a mudança.
  A resposta em texto permanece disponível. Interromper, sair da página ou da
  conta cancela requisição/reprodução e ignora áudio atrasado. Cancelar não
  garante estorno dos créditos se o provedor já recebeu o pedido.
- O iOS/Android pode bloquear reprodução automática depois da geração. Toque
  em **Ouvir resposta** ou **Testar voz** para reproduzir o áudio já preparado.
  O teste usa uma frase real e também consome a cota quando gera áudio novo.
  A conversa contínua aguarda o áudio terminar antes de pedir outra escuta.
- Não existe reprodução com tela bloqueada nem escuta permanente. Xbox Edge,
  microfone físico, fones, reprodução automática e retomada precisam de teste
  no aparelho. A build Pages continua usando voz nativa, pois não acessa a
  sessão privada do Render.

## Verificação local

`npm test` testa a configuração, plano gratuito, cotas, cancelamento, limites,
sanitização de erros e a proteção da rota. `npm run test:e2e -- e2e/speech.spec.ts`
testa reprodução, alternativa nativa, interrupção, preferências e bloqueio de
reprodução em Chromium desktop/celular. Um teste decodifica um MP3 real; o arquivo
`e2e/fixtures/tone.mp3` é um tom sintético gerado localmente para testes, sem voz
ou dados pessoais. Esses testes não usam uma chave real nem provam acesso à
conta ElevenLabs ou funcionamento em um celular/Xbox físico.

Referência da integração: [SDK oficial ElevenLabs](https://github.com/elevenlabs/elevenlabs-python)
(`text_to_speech.convert`, `user.subscription.get`). Plano/cotas atuais devem
ser confirmados na sua própria conta.
