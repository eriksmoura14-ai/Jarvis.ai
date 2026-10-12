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

## Responder em áudio e estilo JARVIS brasileiro

A leitura automática do chat vem ligada nesta atualização. A antiga preferência
v1 gravava `false` mesmo sem uma escolha explícita; v2 inicia a leitura uma vez
e preserva as próximas escolhas, inclusive desligar. Desative em **Preferências
→ Ler respostas automaticamente no chat**. No modo voz, **Preferências → Som no modo voz** controla
a leitura. Somente a resposta final é falada; rascunhos e erros da IA não são.

**Estilo de fala → JARVIS · português brasileiro, calmo e preciso** vem
selecionado nesta atualização. A preferência passa de v1 para v2 uma vez; novas
escolhas continuam salvas por navegador. O teste diz “Bom dia, senhor” em
português. No ElevenLabs, o perfil usa maior estabilidade (0,7) e menos
expressividade (0); no aparelho, prefere uma voz `pt-BR` e ritmo 0,94. Uma voz
nativa escolhida manualmente tem prioridade. O perfil não troca o timbre/gênero
nem comprova uma cópia da dublagem. As respostas continuam no idioma da conversa.
“Natural · português” mantém os ajustes anteriores; “Britânico · calmo e preciso”
continua disponível com teste em inglês e preferência nativa `en-GB`.

### Encontrar uma voz brasileira

Em **Preferências → Buscar voz JARVIS brasileira**, o backend consulta a
biblioteca ElevenLabs com sua chave, sem gerar áudio. A chave precisa de
**Voices → Read**; ajuste essa permissão na conta ElevenLabs se o botão informar
que ela está ausente. Não é necessário colocar a chave no navegador ou enviá-la
pelo chat.

A busca consulta até 20 vozes masculinas `pt`/`pt-BR` com “jarvis” no nome e, se
não houver opções elegíveis, consulta até 20 alternativas brasileiras. Exclui
vozes sem `free_users_allowed=true`, idioma/localidade incompatíveis e tarifas
personalizadas. Mostra até seis opções, sem prometer que o nome JARVIS seja a
voz oficial. Não altera sua biblioteca ElevenLabs nem remove vozes existentes.
**Usar [nome]** salva o Voice ID neste navegador, seleciona o perfil brasileiro
e ElevenLabs; não gera áudio. Depois, **Testar ElevenLabs** verifica plano/cota
e testa a voz pela API. Esse teste consome créditos quando cria áudio novo.
Se o serviço exigir, adicione a voz à sua biblioteca pelo ElevenLabs antes de
testar novamente. Se não houver opções gratuitas, a aplicação informa isso e
mantém a voz atual disponível. O acesso real e o timbre dependem da sua conta;
os testes do projeto usam catálogo simulado.

### Cota de voz atingida

**Preferências → Consultar cota de voz** usa a permissão **User → Read** já
necessária para gerar áudio. Retorna somente os caracteres usados, limite,
saldo e data de renovação informada pela API, quando existir. Não gera áudio,
não gasta créditos de síntese, não aumenta limites e não altera faturamento.

Saldo zero indica a cota da conta esgotada. A renovação é a que o ElevenLabs
informar; não há promessa de que esperar um minuto resolva. Um texto maior que
o saldo também é recusado. Uma chave pode ter um limite próprio menor mesmo
com saldo na conta; confira esse limite na seção API Keys. Limites temporários
de requisições são separados. Trocar de voz, chave ou recarregar não repõe o
saldo da conta.

**Usar voz do aparelho · sem cota ElevenLabs** seleciona a síntese nativa. A
qualidade e as vozes disponíveis dependem do Android/Edge; a escolha não
promete o timbre do filme. Não chama o ElevenLabs. No modo Automática, uma
falha do provedor pode usar essa alternativa; no modo ElevenLabs, o erro
continua explícito até você trocar de modo. Texto e leitura automática
permanecem disponíveis conforme os recursos do navegador.

## Como funciona e limites

- A rota autenticada `POST /api/speech` aceita texto até 1.200 caracteres e,
  opcionalmente, `voiceId` alfanumérico (1–100 caracteres) e `profile`
  (`natural`, `british` ou `jarvis-br`). Não recebe chaves, URL ou modelo do frontend.
  O host, o modelo e os ajustes permitidos permanecem definidos no backend.
- As rotas de catálogo (`GET /api/speech/voices`) e saldo (`GET /api/speech/quota`) exigem login, recusam parâmetros extras e têm limite de quatro consultas por minuto/IP, timeout de 20 segundos e respostas com campos limitados. A consulta do catálogo permite até duas chamadas ao host fixo do ElevenLabs; a consulta de saldo faz uma.
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
