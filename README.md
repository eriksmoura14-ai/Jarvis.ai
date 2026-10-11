# JARVIS AI · MVP 0.1

Assistente pessoal para o navegador, inspirado na estética futurista do JARVIS. React, TypeScript, Vite, Tailwind CSS, Fastify e SQLite. Sem API paga, cartão de crédito ou credenciais no frontend.

**Uso pessoal com login:** [ativar senha, perfil, memória editável e sincronização no Render com Supabase](docs/personal.md). Nome e tratamento acompanham sua conta. Correções e exclusões reiniciam o contexto enviado à IA, preservando o histórico visível. O acesso só fica protegido depois de configurar `JARVIS_PASSWORD`.

**Voz mais natural:** [ativar ElevenLabs no plano Free](docs/voice.md), com chave somente no backend e botão **Testar ElevenLabs**, que usa só a voz natural e mostra erros. O modo Automática permite a voz do aparelho como alternativa. Precisa de conta, chave e voz configuradas; a voz padrão continua sem credenciais.

**Ritmo da conversa e recepção:** [resposta progressiva, voz em partes, tempos reais, “Jarvis, pare” e notícias opcionais ao abrir](docs/conversation.md). Não exige novas chaves, variáveis ou tabelas; usa as integrações já configuradas. Notícias e interrupção por voz são ativadas em Preferências, por aparelho.

**Interpretação de pedidos:** [conversa, consulta às notas pessoais e pesquisa automática com consultas complementares](docs/interpretation.md). Com IA compatível, perguntas livres podem solicitar até três buscas, incluindo continuação do último assunto público. Comandos de notas e perguntas pessoais reconhecidas têm prioridade mesmo com a opção web marcada.

Dois modos de execução: **servidor**, com API Fastify e notas SQLite, e **GitHub Pages**, com os mesmos comandos e notas processados e armazenados no navegador. O modo padrão continua sendo o servidor; a build `pages` não exige API.

**Projetos e tarefas:** [objetivos, etapas, prazos, progresso e propostas do chat para revisar](docs/projects.md). No modo pessoal, os dados acompanham sua conta no celular e computador. O painel funciona sem IA; planos propostos pela IA só são aplicados após **Confirmar proposta**. Reutiliza o Supabase existente, sem nova chave ou SQL.

**Os comandos locais funcionam sem IA.** A conversa livre e o contexto recente têm integração opcional com Groq ou Ollama pelo backend, mas exigem um modelo configurado e acessível. Sem essa configuração, o site informa “IA não configurada” e mantém os comandos locais. O comando `pesquise <assunto>` consulta a web com fontes pelo backend, sem chave adicional de busca. O modelo pode solicitar pesquisa pública ou propor mudanças em projetos pessoais para confirmação. O aplicativo não controla o sistema operacional.

## Começar

Pré-requisitos: **Node.js 24.x** e npm. A versão está em `.nvmrc`; SQLite é fornecido pelo próprio Node (`node:sqlite`), sem serviço separado ou compilação de módulo nativo. Dependendo da versão do Node, essa API pode emitir um aviso experimental.

```bash
git clone https://github.com/eriksmoura14-ai/Jarvis.ai.git
cd Jarvis.ai
# Se usar nvm: nvm install && nvm use
npm ci
npm run dev
```

Em um checkout existente, execute somente `npm ci` e `npm run dev`. O comando inicia a API na porta 3001 e o Vite na porta 5173. Abra o endereço do Vite no navegador. O Vite encaminha `/api` à API; não é necessário configurar CORS.

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Frontend e backend com recarga |
| `npm run dev:web` | Somente Vite |
| `npm run dev:server` | Somente Fastify, reiniciando ao editar |
| `npm run typecheck` | Verificação TypeScript de ambos |
| `npm test` | Testes unitários e de integração (Vitest) |
| `npm run test:watch` | Testes em modo contínuo |
| `npm run build` | Typecheck, build frontend e compilação backend |
| `npm run build:pages` | Build estática funcional para GitHub Pages em `dist-pages/` |
| `npm run preview:pages` | Servir a build Pages para validação local |
| `npm run test:pages` | Testes desktop/celular sem API para a build Pages |
| `npm start` | Servir a aplicação compilada e a API na porta 3001 |
| `npm run test:e2e` | Testes de navegador em desktop e celular |
| `npm run test:personal` | Login, memórias e sincronização com SQLite em desktop/celular |
| `npm run test:projects` | Projetos, tarefas e revisão de propostas em desktop/celular |
| `npm run check` | Testes, build e testes de navegador |

`npm start` exige `npm run build` e deve ser executado na raiz do projeto. Fastify serve `dist/` e `/api` na mesma origem. Para testar essa versão com Playwright, execute `E2E_PRODUCTION=1 npm run test:e2e` em Bash, após o build. No PowerShell: `$env:E2E_PRODUCTION='1'; npm run test:e2e`.

O backend lê `.env` se existir. Para personalizar, copie `.env.example` para `.env` (não versionado):

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `HOST` | `127.0.0.1`; `0.0.0.0` no Render | Interface de rede da API; valor explícito tem prioridade |
| `PORT` | `3001` | Porta da API |
| `DATABASE_PATH` | `./data/jarvis.sqlite` | Arquivo SQLite de notas |

No desenvolvimento, mantenha a API na porta 3001 para o proxy do Vite. Em uma rede doméstica confiável, o Vite escuta em `0.0.0.0`: celular e Xbox podem acessar o IP do computador na porta 5173, se o firewall permitir. Para a versão compilada aceitar conexões na rede, configure `HOST=0.0.0.0`. Isso **não fornece HTTPS**. Use um proxy HTTPS se precisar de microfone fora de `localhost`.

## Hospedar no GitHub Pages

O workflow `.github/workflows/pages.yml` testa e publica a build estática somente por execução manual, para que alterações de uso pessoal no Render não iniciem publicações automáticas no Pages. Ele usa apenas o token padrão do GitHub Actions: não requer cadastrar credenciais nem contratar servidor.

1. No repositório, abra **Settings → Pages**.
2. Em **Build and deployment → Source**, selecione **GitHub Actions**.
3. Abra **Actions → Publish GitHub Pages → Run workflow**, usando `main`.
4. Aguarde o job `deploy` concluir. O endereço esperado é `https://eriksmoura14-ai.github.io/Jarvis.ai/`; sua existência só é confirmada após o deploy.

Essa opção funciona em repositório público sem assinatura paga. A build usa o caminho `/Jarvis.ai/`, inclusive nos assets e favicon. Se renomear o repositório, ajuste o `base` do modo `pages` em `vite.config.ts`.

No site Pages, o rótulo **Modo navegador** identifica a execução sem servidor. Hora, data, cálculos e notas usam o mesmo `LocalProvider` do backend. Notas são salvas em `localStorage`, separadas por sessão; os comandos locais não são enviados à API. Ao conectar um backend em Preferências, perguntas livres enviam a mensagem e o contexto recente a esse servidor e ao provedor de IA. O histórico continua no navegador. Dados da versão servidor não migram automaticamente para Pages e não há sincronização entre dispositivos. O reconhecimento de voz continua sujeito aos serviços e permissões do próprio navegador.

Para validar antes de publicar:

```bash
npm run build:pages
npm run test:pages
npm run preview:pages
```

O GitHub Pages serve o site via HTTPS, mas não executa Fastify nem SQLite. Esses componentes ficam no código para uso no modo servidor. A versão Pages não é uma PWA: ela precisa carregar os arquivos do site e não garante abertura offline.

## Funcionalidades implementadas

- Interface em português, tema escuro e detalhes azuis, núcleo animado em CSS/SVG, layouts para desktop e celular.
- Tela inicial de voz com núcleo central, estados de escuta/processamento/fala, última resposta visível e histórico recolhido. Botão **Chat** abre a interface completa; a escolha de tela permanece ao recarregar.
- Chat conectado à API real, com processamento, erros, limite de tamanho e preservação do texto quando o envio falha.
- Comandos de saudação, ajuda, hora/data no fuso do navegador, cálculo e notas.
- Modo opcional para um único dono: login por senha, sessões revogáveis, memória salva por pedido explícito, exclusão individual, histórico/notas sincronizados e importação consentida de mensagens antigas. SQLite local ou Supabase para persistir no Render; [configuração](docs/personal.md).
- Sem login configurado, histórico das últimas 100 mensagens em `localStorage`, restauração após recarga e limpeza com confirmação. Dados inválidos são ignorados; falhas de armazenamento são informadas.
- Notas persistentes em SQLite no modo servidor ou `localStorage` no modo Pages, associadas à sessão do navegador. Limpar a conversa preserva as notas.
- Modo de voz: reconhecimento via Web Speech API, ativado pelo usuário; ao terminar a fala, o comando é enviado e a resposta é lida automaticamente. Conversa contínua opcional volta a ouvir **depois** da resposta, com a escuta comum desligada durante a reprodução. A interrupção experimental “Jarvis, pare”, quando ativada, escuta somente esse comando durante a fala. Cada escuta tem limite de 60 segundos.
- Modo chat: captura com `getUserMedia` e `MediaRecorder`, mediante ação e permissão, reprodução local e descarte. A transcrição entra no campo para revisão, **sem envio automático** neste modo.
- Síntese de voz do navegador, seleção de voz em Preferências, repetição da resposta e interrupção. No modo voz, respostas faladas começam ativadas; no chat, a leitura automática é opcional, desligada por padrão e sua preferência é persistida.
- Resposta progressiva do Groq/Ollama com texto provisório fora do histórico; cancelamento e mudanças de memória descartam o rascunho. Tempos de rede, resposta, armazenamento e voz em Preferências.
- Leitura em até duas partes, preparando a segunda enquanto a primeira toca; cache de até dois áudios somente na memória da página.
- Recepção com o perfil da conta; resumo de notícias por botão ou consulta opcional uma vez ao dia neste aparelho, com fontes e leitura configurável.
- Interrupção experimental dizendo “Jarvis, pare” durante uma conversa iniciada pelo microfone; desligada por padrão, sem abrir o microfone ao carregar a página.
- Interrupção pelo botão central ou Escape; troca de aba/aplicativo pausa a conversa e exige novo toque para retomar. Respostas atrasadas de pedidos interrompidos não iniciam leitura. Digitação permanece disponível.
- Controles com foco visível, rótulos acessíveis, áreas de toque, diálogo com foco contido, retorno do foco, região de mensagens acessível e respeito a `prefers-reduced-motion`.
- Navegação por Tab/Shift+Tab e suporte à Gamepad API para controles de mapeamento padrão: direcional percorre controles; A ativa; B fecha o diálogo. A consulta ao controle só roda quando há um controle conectado.
- Integração opcional com Groq e Ollama no backend, contexto de até 10 mensagens/8.000 caracteres e identificação de respostas da IA. Os comandos conhecidos têm prioridade e não consomem o modelo. A conexão externa no Pages é configurada por endereço HTTPS, sem chave no frontend.
- Pesquisa explícita por voz/texto ou opção **Pesquisar na web**, com filtro por assunto, até cinco fontes clicáveis, trechos reais e resumo opcional pela IA. Pedidos de notícias consultam fontes datadas nos últimos sete dias e exibem a data de publicação informada pelo feed. Veja [uso pessoal e limites da pesquisa](docs/search.md).
- API com validação de corpo/contexto, limite de requisições, orçamento diário de IA persistido em SQLite, cancelamento, respostas de erro, CORS por origem explícita, cabeçalhos de segurança e consultas parametrizadas.

### Experimente

No celular, abra o site por HTTPS, toque no microfone e permita o acesso. Fale, por exemplo, **“Jarvis, que horas são?”**. O reconhecimento termina quando o navegador detecta o fim da fala; o botão central também conclui a escuta. Para falar novamente sem tocar após cada resposta, marque **Conversa contínua** antes de começar. Se a voz for bloqueada, use **Ouvir resposta** ou o botão de teclado. O aplicativo não escuta ao abrir nem ao recarregar a página.

| Mensagem | Resultado |
| --- | --- |
| `ajuda` | Lista de comandos |
| `olá` | Saudação |
| `que horas são?` ou `hora` | Horário no fuso do navegador |
| `data` | Data por extenso |
| `calcular (12 + 8) / 2` | Resultado `10` |
| `calcular 1,5 * 2` | Resultado `3` |
| `Jarvis, calcular dois mais cinco` | Resultado `7`, aceitando a forma falada |
| `anotar revisar portfólio` | Salva a nota |
| `notas` | Lista as notas desta sessão |
| `apagar notas` | Exclui todas as notas desta sessão, sem desfazer |

A calculadora aceita números, decimais com vírgula/ponto, `+`, `-`, `*`, `/` e parênteses. Também converte números falados de zero a dez e operadores como “mais”, “menos”, “vezes” e “dividido por”. Usa um parser limitado, sem `eval`, e rejeita divisão por zero, expressões inválidas e código. Não é uma calculadora científica nem apropriada para cálculos financeiros de precisão. “Jarvis” no início é um prefixo de comando; **não há detecção de palavra de ativação em segundo plano**.

## Conectar a conversa com IA

Veja [a instalação do modelo e a conexão pelo celular](docs/ai.md). A integração está implementada, mas esta publicação não inclui uma chave Groq nem um servidor Ollama/hospedagem de backend. Ativar somente a interface não cria um modelo nem um servidor.

- **Groq:** requer chave no backend, modelo disponível e uma conta com cota gratuita; confira os limites e condições no painel do provedor. Não cadastre cobrança para esta etapa.
- **Ollama:** executa um modelo no seu computador/servidor, sem chave nem cobrança por chamada. Requer instalação, download do modelo, memória suficiente e a máquina ligada.
- O GitHub Pages continua hospedando apenas a interface. Para celular fora da rede local, o backend precisa estar online em HTTPS.

## Arquitetura

```text
src/
  App.tsx                 Turnos de voz, chat, histórico e preferências
  components/             VoiceScene, núcleo visual e diálogo acessível
  hooks/                  Captura/transcrição, síntese e controle
  lib/                    Cliente HTTP e histórico validado
  styles.css              Tailwind e estilos responsivos
  voice.css               Tela central, toque e áreas seguras no celular
server/
  index.ts                Inicialização e encerramento
  app.ts                  Fastify, validação e arquivos estáticos
  calculator.ts           Parser aritmético
  database.ts             SQLite e armazenamento de notas
  providers/
    types.ts              Contrato AssistantProvider
    local.ts              Motor local de comandos
    model.ts              Chamadas Groq/Ollama e configuração segura
    hybrid.ts             Prioridade local e limites de IA
    research.ts           Pesquisa explícita/automática e resumo com fontes
  interpretation.ts       Intenção, ferramentas e seleção de notas/projetos
  search.ts               DuckDuckGo HTML / Bing RSS, limites e extração
  personal/               Login, sessões, comandos de memória e SQLite/Supabase
shared/contracts.ts       Tipos de mensagem e contratos HTTP
shared/context.ts         Seleção limitada do contexto recente
shared/search.ts          Comandos de pesquisa e validação de fontes
shared/projects.ts        Projetos, tarefas, validação e prioridades
supabase/personal.sql     Tabela privada com RLS para o dono
e2e/                      Testes Playwright
e2e-personal/             Login, memória e sincronização em navegador
e2e-projects/             Projetos e confirmação de propostas em navegador
.github/workflows/ci.yml   Testes e build no GitHub Actions
```

Fluxo servidor: React → `POST /api/chat` → provedor local → SQLite quando o comando usa notas → resposta em texto. `GET /api/health` verifica a API. No modo Pages: React → adaptador `src/lib/browser.ts` → o mesmo provedor em `shared/local.ts` → `localStorage`, sem requisições à API. A calculadora comum fica em `shared/calculator.ts`. O horário usa o fuso IANA informado pelo navegador, validado no backend quando há API.

`buildApp({ ai })` compõe o motor local com `ModelProvider`; `buildApp({ provider })` permite injetar outro provedor. Pedidos reconhecidos são locais. Pedidos desconhecidos usam o modelo somente quando configurado. Não há SDK de IA no frontend: as chamadas HTTP e a chave Groq ficam no backend. No Pages, comandos conhecidos continuam no navegador; perguntas livres e pesquisas explícitas seguem para o backend configurado. `ResearchProvider` prioriza pedidos pessoais, detecta pesquisas explícitas ou aceita uma solicitação estruturada do modelo. Consulta buscadores fixos e envia os trechos ao modelo para resumo. As URLs das fontes não são destinos de fetch no servidor. Sem modelo, retorna a lista de resultados.

### Dados e privacidade

No **modo pessoal autenticado**, histórico, notas, memórias explícitas, projetos/tarefas, sessões e orçamento de IA ficam no backend SQLite/Supabase. O histórico pessoal não é gravado no localStorage; somente preferências de interface/voz permanecem locais. Memórias e seleções de notas/projetos podem acompanhar perguntas à IA. Consulte [dados, exclusão e ativação](docs/personal.md). Não há migração automática nem backup próprio.

Os parágrafos abaixo descrevem o **modo servidor sem login configurado**. No modo Pages, tanto o histórico quanto as notas ficam no navegador. Sem backend configurado, a conversa não é enviada a uma API pelo aplicativo; com IA configurada, perguntas livres e contexto recente são enviados ao backend e ao provedor. Os dois modos não compartilham notas automaticamente.

O histórico é salvo apenas no navegador (`jarvis.history.v1`). Cada mensagem é enviada ao backend para responder, mas o backend não persiste a conversa. Logs padrão de requisição não incluem o corpo da mensagem. Quando a IA está ativada, o provedor recebe a pergunta e até 10 mensagens recentes (máximo de 8.000 caracteres de contexto); consulte sua política de retenção. Pesquisas enviam o assunto ao buscador; os trechos também acompanham o resumo por IA. A tabela `ai_usage` mantém apenas contagens diárias, não o texto da conversa.

As **notas** ficam em `data/jarvis.sqlite`, incluindo os arquivos de WAL do SQLite, e pertencem ao UUID guardado em `jarvis.session.v1`. Copiar esse UUID possibilita acessar as notas da sessão: ele não substitui autenticação. Limpar os dados do site ou usar outro navegador cria outra sessão, sem recuperar as notas anteriores. Para removê-las antes de limpar o site, use `apagar notas`.

Sem `JARVIS_PASSWORD`, não há autenticação nem sincronização entre dispositivos. Nenhum modo oferece criptografia adicional de ponta a ponta ou backup automático. Use como MVP em máquina/rede confiável; adicione autenticação e proteção de dados antes de expor a API em produção pública. Limites: 2.000 caracteres por mensagem, 100 notas por sessão, 100 mensagens locais e 60 requisições de chat por minuto/IP.

## Áudio nos navegadores

- Microfone exige um contexto seguro: HTTPS ou `localhost`. Um endereço HTTP de rede doméstica normalmente não é suficiente. O modo voz usa diretamente `SpeechRecognition`, sem abrir uma segunda gravação, para evitar disputa pelo microfone no celular. O modo chat exige `getUserMedia` e `MediaRecorder` para gravar. Permissão negada, microfone ausente e falha de captura exibem mensagens e preservam a digitação.
- No chat, o áudio gravado não é enviado à API nem salvo em disco/localStorage. Um `Blob` temporário permite reprodução nesta página e é liberado ao descartar, substituir, mudar de modo ou sair. Codec/formato são escolhidos pelo navegador. No modo voz, não há gravação reproduzível no aplicativo.
- `SpeechRecognition`/`webkitSpeechRecognition` variam por navegador, dispositivo, idioma e política. Chrome/Edge podem usar um serviço externo de reconhecimento, que pode exigir rede e enviar áudio ao fornecedor do navegador. A existência da API não garante funcionamento. Não há promessa de transcrição offline.
- Quando reconhecimento não está disponível, o modo voz mostra a digitação; no chat, a captura pode permitir apenas ouvir a própria gravação. No chat, revise a transcrição e clique em enviar. No modo voz, a transcrição final é enviada automaticamente: comandos como `apagar notas` executam ao concluir a fala.
- `speechSynthesis` depende das vozes instaladas, idioma e regras de reprodução do navegador. Algumas plataformas exigem um gesto para tocar áudio e podem bloquear leitura automática; o botão “Ouvir” continua sendo uma tentativa explícita. Texto sempre permanece disponível. Leituras são limitadas aos primeiros 4.000 caracteres.
- A integração opcional com ElevenLabs usa a rota autenticada `/api/speech` e verifica plano Free/cota antes de gerar MP3. O modo ElevenLabs mostra falhas sem trocar de voz; Automática permite a voz do aparelho como alternativa. O texto lido é enviado ao provedor; não há envio de gravação do microfone para essa integração. Leituras por IA têm até 1.200 caracteres. Consulte [ativação, privacidade e limites](docs/voice.md).
- Conversa contínua é por turnos e não permite falar por cima da resposta: primeiro interrompa com o botão central. Erros de reconhecimento/voz e troca de aplicativo desativam a repetição. iOS/Android podem exigir outro toque para cada escuta ou bloquear reprodução; não há escuta com tela bloqueada ou em segundo plano. A escolha de voz depende do navegador/sistema ou da configuração do ElevenLabs; não imita automaticamente a voz do personagem.
- No Xbox, entrada/saída de áudio, reconhecimento, permissões, teclado virtual e exposição da Gamepad API precisam ser confirmados no Edge do console. O MVP não promete suporte de voz nesse dispositivo.

## Testes

```bash
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Em Linux, caso faltem bibliotecas do navegador, use `npx playwright install --with-deps chromium` com as permissões adequadas. O runner usa `/usr/bin/chromium` se encontrado; caso contrário, usa o Chromium instalado pelo Playwright. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` permite escolher outro executável.

Vitest cobre cálculos válidos/inválidos e falados, API real por injeção Fastify, validação, fuso, limites, persistência/reabertura SQLite, isolamento entre sessões e recuperação do histórico. Playwright exercita o frontend com a API e SQLite reais em contextos separados de desktop/celular: conversa, recarga, limpeza, notas, falha de rede, fallback de voz, permissão negada, preferências, layout/movimento reduzido, cancelamento de permissão pendente, captura/reprodução/descarte de áudio, transcrição, síntese e controle. O modo de voz também cobre envio automático, espera pela fala antes de nova escuta, interrupção, resposta atrasada, mudança de aplicativo e histórico. Os testes Pages exercitam esse fluxo sem backend. Testes adicionais verificam o contrato dos provedores, contexto, limites, CORS, erros sanitizados e cancelamento do modelo. Um servidor HTTP controlado simula a API Ollama; isso valida a conexão, sem demonstrar uma inferência real. A captura usa `MediaRecorder` real com um dispositivo de áudio sintético do Chromium; reconhecimento, síntese e gamepad são simulados. Os testes usam um banco temporário em `/tmp`, não o banco de desenvolvimento. Essas simulações não demonstram a qualidade de um microfone, uma transcrição real ou a compatibilidade física com o Xbox.

### Checklist manual no celular

- [ ] Abrir por HTTPS no Chrome/Android e Safari/iOS; testar retrato, paisagem, zoom, teclado virtual e barras do navegador.
- [ ] Permitir/negar microfone, falar `Jarvis, que horas são?` e confirmar transcrição, envio único e voz real.
- [ ] Escolher uma voz disponível em português; verificar bloqueio de reprodução automática e **Ouvir resposta**.
- [ ] Testar conversa contínua, conclusão da escuta e interrupção pelo botão central; registrar quando o navegador exige outro toque.
- [ ] Trocar de aplicativo, bloquear/desbloquear a tela e retornar; confirmar a pausa e a necessidade de retomar manualmente.
- [ ] Sem reconhecimento/voz, enviar por digitação; verificar histórico e notas após recarga.

### Checklist manual no Xbox

- [ ] No modo pessoal, entrar pelo teclado virtual, testar direcional/A/B no login e nas memórias e verificar persistência da sessão.
- [ ] Abrir pelo Edge do console na rede confiável; verificar legibilidade na TV, zoom e margens visíveis.
- [ ] Navegar por todos os controles com direcional/teclado; confirmar foco visível, A, B, rolagem e diálogo. O Edge pode mapear os botões de forma diferente ou não expor Gamepad API.
- [ ] Ativar o teclado virtual, enviar com o botão, editar texto longo e testar Shift+Enter com teclado físico.
- [ ] Enviar `hora`, `calcular (12 + 8) / 2`, criar/listar/apagar notas; verificar fuso.
- [ ] Recarregar a página e fechar/reabrir o navegador para verificar o histórico e as políticas de armazenamento do console.
- [ ] Testar “Ouvir”, vozes em português e interrupção. Registrar se áudio está bloqueado.
- [ ] Em HTTPS, testar permissão do microfone/headset, negar permissão, parar gravação e transcrição, se suportadas.
- [ ] Confirmar que, sem microfone/transcrição/síntese, todo o fluxo continua por texto.
- [ ] Verificar desempenho, suspensão do console e recuperação após a API perder conexão.

## Próximos passos

1. Configurar um provedor real e backend HTTPS; validar uma conversa real no celular e a disponibilidade/cota do provedor. Validar também Xbox, Safari/iOS, Edge desktop e Android com dispositivos físicos.
2. Ativar e validar o modo pessoal com Supabase no seu serviço; acrescentar backup/exportação e exclusão individual de notas.
3. Ampliar projetos/tarefas com edição, exclusão e exportação; planejar lembretes e calendário com opt-in antes de integrações externas.
4. Expandir comandos e contexto de conversa sem prometer funções não implementadas.
5. Adicionar PWA/cache com estratégia offline — o modo servidor exige a API em execução; Pages precisa carregar os arquivos estáticos — e ampliar testes de acessibilidade com leitores de tela.

JARVIS AI é um projeto independente de portfólio. Não possui afiliação com Marvel, Microsoft ou seus produtos.
