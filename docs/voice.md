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
   e abra **Preferências → Testar ElevenLabs**. Esse botão seleciona e salva
   **ElevenLabs · voz natural**, inclusive se o aparelho estava selecionado.
   Se falhar, o teste mostra o motivo e não reproduz a voz nativa.
   A indicação de configuração significa que as variáveis foram lidas;
   somente a reprodução bem-sucedida confirma a chave, a voz e o acesso real.

Em **Tipo de voz**, o modo **ElevenLabs · voz natural** mostra erros e mantém o
texto quando o serviço falha. O modo **Automática** permite usar a voz nativa como
alternativa. **Testar voz** testa o modo escolhido; **Testar ElevenLabs** usa
somente ElevenLabs. A indicação **Voz reproduzida: ElevenLabs** aparece quando o
navegador inicia a reprodução do áudio retornado pela integração.

Para desativar no servidor, use `TTS_PROVIDER=browser`. Para usar somente a voz
do aparelho sem alterar o servidor, selecione **Voz do aparelho** em Preferências.
Essa escolha e a voz nativa escolhida são guardadas por navegador/dispositivo.
O Voice ID do servidor vale para todos os aparelhos. Em **Preferências → Voice
ID do ElevenLabs**, você pode salvar outro identificador para este navegador,
sem alterar a chave. Vazio volta à voz do servidor. Trocar a escolha descarta os
áudios anteriores. Alterar voz/estilo ou iniciar um teste interrompe a conversa
atual, cancela a preparação das partes e ignora respostas atrasadas, para não
reproduzir a voz antiga. Para usar o mesmo ID como padrão no celular e Xbox, configure
`ELEVENLABS_VOICE_ID` no Render e deixe esse campo vazio nos dois aparelhos;
atualize as páginas depois de trocar a variável.

## Responder em áudio e estilo britânico

A leitura automática do chat vem ligada nesta atualização. A antiga preferência
v1 gravava `false` mesmo sem uma escolha explícita; v2 inicia a leitura uma vez
e preserva as próximas escolhas, inclusive desligar. Desative em **Preferências
→ Ler respostas automaticamente no chat**. No modo voz, o botão de som controla
a leitura. Somente a resposta final é falada; rascunhos e erros da IA não são.

**Estilo de fala → Britânico · calmo e preciso** vem selecionado. Usa maior
estabilidade e menos expressividade no ElevenLabs e uma frase de teste em
inglês com “sir”. Na síntese nativa, prefere `en-GB` quando disponível e usa ritmo
0,94. Uma voz nativa escolhida manualmente tem prioridade. No ElevenLabs, é
necessário escolher uma voz masculina britânica disponível pela API Free na
[biblioteca](https://elevenlabs.io/app/voice-library), salvar seu Voice ID e testar.
O perfil não altera o timbre/gênero de uma voz existente, não garante a voz do
ator do filme e não traduz as respostas. Para respostas em inglês, converse em
inglês ou peça explicitamente esse idioma. “Natural · português” restaura o
teste em português e os ajustes anteriores. Perfil e Voice ID escolhido no
aplicativo são preferências deste navegador.

## Como funciona e limites

- A rota autenticada `POST /api/speech` aceita texto até 1.200 caracteres e,
  opcionalmente, `voiceId` alfanumérico (1–100 caracteres) e `profile`
  (`natural` ou `british`). Não recebe chaves, URL ou modelo do frontend.
  O host, o modelo e os ajustes permitidos permanecem definidos no backend.
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
  salva MP3 no Supabase, em disco ou no localStorage. Conserva até dois
  áudios na memória da página para repetir sem nova geração. Sair da conta ou
  recarregar a página descarta esse áudio. Repetir outra resposta pode gerar
  áudio e consumir cota novamente.
- No modo Automática, falha do provedor ou cota esgotada tenta a síntese nativa e informa a mudança.
  No modo ElevenLabs, exibe o erro e não troca para voz nativa. Códigos conhecidos
  do provedor são traduzidos para indicar chave inválida, permissão de consulta
  ou geração, limite da conta/chave, voz indisponível, recurso pago ou bloqueio
  por atividade incomum. Mensagens externas não são exibidas ou registradas.
  A resposta em texto permanece disponível. Interromper, sair da página ou da
  conta cancela requisição/reprodução e ignora áudio atrasado. Cancelar não
  garante estorno dos créditos se o provedor já recebeu o pedido.
- O iOS/Android pode bloquear reprodução automática depois da geração. Toque
  em **Ouvir resposta**, **Testar voz** ou **Testar ElevenLabs** para reproduzir o áudio já preparado.
  O teste usa uma frase real e também consome a cota quando gera áudio novo.
  A conversa contínua aguarda o áudio terminar antes de pedir outra escuta.
  Um bloqueio de autoplay tem mensagem própria, distinta de falha de geração
  ou reprodução. Se a tela indicar reprodução mas você não ouvir, confira
  volume, aba silenciada e saída de áudio/fones. Não há como verificar daqui
  o volume físico do seu dispositivo.
- Não existe reprodução com tela bloqueada nem escuta permanente. Xbox Edge,
  microfone físico, fones, reprodução automática e retomada precisam de teste
  no aparelho. A build Pages continua usando voz nativa, pois não acessa a
  sessão privada do Render.

## Ritmo e interrupção

**Preferências → Voz em partes** vem ativada: divide uma leitura maior em até
duas partes, respeitando o teto total de 1.200 caracteres. A primeira começa
quando seu MP3 está pronto; a segunda é preparada durante essa reprodução e
só toca depois. Cada parte verifica o plano Free/cota e conta como uma chamada
no limite de 10 por minuto. Uma falha na segunda parte não refaz o pedido:
no modo Automática tenta a voz do aparelho; no modo ElevenLabs fica no texto.
Interromper cancela também a preparação antecipada. Desative essa preferência
para gerar um único MP3. Os dois áudios mais recentes ficam apenas em RAM,
incluindo o áudio cuja reprodução o celular bloqueou.

**Interromper dizendo “Jarvis, pare”** é opcional e experimental. Só abre o
reconhecimento durante a reprodução de uma conversa iniciada por você no
microfone. Reconhece `Jarvis, pare`, `Jarvis, parar`, `Jarvis, pausa`, `Jarvis,
pause` e `Jarvis, silêncio`. Não envia essas transcrições ao chat nem aceita
outra pergunta enquanto a voz está falando. Ignora fala comum e comandos que
apareçam literalmente no texto lido, para reduzir auto-interrupção por eco.
Isso não é cancelamento acústico de eco: use fones e teste no seu aparelho.
Falhas do reconhecimento preservam a reprodução e o botão central. Depois de
até duas tentativas de retomar uma escuta encerrada, o botão continua disponível.
Desligar a opção, parar a reprodução, sair/trocar de aplicativo ou de conta
encerra essa escuta. Não há palavra de ativação permanente, detecção de palmas,
conversa com tela bloqueada ou escuta automática ao abrir o site.

Veja [tempos da conversa e recepção pessoal](conversation.md). A leitura aguarda
a confirmação final da resposta/contexto pelo servidor; o texto progressivo é
um rascunho e não é falado nem gravado como resposta definitiva.

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
