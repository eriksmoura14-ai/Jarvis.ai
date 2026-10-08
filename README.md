# JARVIS AI · MVP 0.1

Assistente pessoal para o navegador, inspirado na estética futurista do JARVIS. React, TypeScript, Vite, Tailwind CSS, Fastify e SQLite. Sem API paga, cartão de crédito ou credenciais no frontend.

Dois modos de execução: **servidor**, com API Fastify e notas SQLite, e **GitHub Pages**, com os mesmos comandos e notas processados e armazenados no navegador. O modo padrão continua sendo o servidor; a build `pages` não exige API.

**O MVP é um motor de comandos locais, não um modelo generativo de IA.** Não navega na internet, não controla o sistema operacional e não entende pedidos arbitrários. A interface informa esse limite. O código de provedores permite integrar um modelo em uma próxima etapa.

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
| `npm run check` | Testes, build e testes de navegador |

`npm start` exige `npm run build` e deve ser executado na raiz do projeto. Fastify serve `dist/` e `/api` na mesma origem. Para testar essa versão com Playwright, execute `E2E_PRODUCTION=1 npm run test:e2e` em Bash, após o build. No PowerShell: `$env:E2E_PRODUCTION='1'; npm run test:e2e`.

O backend lê `.env` se existir. Para personalizar, copie `.env.example` para `.env` (não versionado):

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface de rede da API |
| `PORT` | `3001` | Porta da API |
| `DATABASE_PATH` | `./data/jarvis.sqlite` | Arquivo SQLite de notas |

No desenvolvimento, mantenha a API na porta 3001 para o proxy do Vite. Em uma rede doméstica confiável, o Vite escuta em `0.0.0.0`: celular e Xbox podem acessar o IP do computador na porta 5173, se o firewall permitir. Para a versão compilada aceitar conexões na rede, configure `HOST=0.0.0.0`. Isso **não fornece HTTPS**. Use um proxy HTTPS se precisar de microfone fora de `localhost`.

## Hospedar no GitHub Pages

O workflow `.github/workflows/pages.yml` testa e publica a build estática em pushes para `main` ou execução manual. Ele usa apenas o token padrão do GitHub Actions: não requer cadastrar credenciais nem contratar servidor.

1. No repositório, abra **Settings → Pages**.
2. Em **Build and deployment → Source**, selecione **GitHub Actions**.
3. Abra **Actions → Publish GitHub Pages → Run workflow**, usando `main`.
4. Aguarde o job `deploy` concluir. O endereço esperado é `https://eriksmoura14-ai.github.io/Jarvis.ai/`; sua existência só é confirmada após o deploy.

Essa opção funciona em repositório público sem assinatura paga. A build usa o caminho `/Jarvis.ai/`, inclusive nos assets e favicon. Se renomear o repositório, ajuste o `base` do modo `pages` em `vite.config.ts`.

No site Pages, o rótulo **Modo navegador** identifica a execução sem servidor. Hora, data, cálculos e notas usam o mesmo `LocalProvider` do backend. Notas são salvas em `localStorage`, separadas por sessão; nenhuma conversa é enviada à API. O histórico também permanece no navegador. Dados da versão servidor não migram automaticamente para Pages e não há sincronização entre dispositivos. O reconhecimento de voz continua sujeito aos serviços e permissões do próprio navegador.

Para validar antes de publicar:

```bash
npm run build:pages
npm run test:pages
npm run preview:pages
```

O GitHub Pages serve o site via HTTPS, mas não executa Fastify nem SQLite. Esses componentes ficam no código para uso no modo servidor. A versão Pages não é uma PWA: ela precisa carregar os arquivos do site e não garante abertura offline.

## Funcionalidades implementadas

- Interface em português, tema escuro e detalhes azuis, núcleo animado em CSS/SVG, layouts para desktop e celular.
- Chat conectado à API real, com processamento, erros, limite de tamanho e preservação do texto quando o envio falha.
- Comandos de saudação, ajuda, hora/data no fuso do navegador, cálculo e notas.
- Histórico das últimas 100 mensagens em `localStorage`, restauração após recarga e limpeza com confirmação. Dados inválidos são ignorados; falhas de armazenamento são informadas.
- Notas persistentes em SQLite no modo servidor ou `localStorage` no modo Pages, associadas à sessão do navegador. Limpar a conversa preserva as notas.
- Captura com `getUserMedia` e `MediaRecorder`, mediante ação e permissão do usuário. Limite de 60 segundos, botão de parada, reprodução local e descarte do áudio.
- Transcrição via Web Speech API quando disponível. O texto entra no campo para revisão, **sem envio automático**. Digitação permanece disponível.
- Síntese de voz: botão “Ouvir” e leitura automática opcional, desligada por padrão. Preferência persistida e botão para parar a leitura.
- Controles com foco visível, rótulos acessíveis, áreas de toque, diálogo com foco contido, retorno do foco, região de mensagens acessível e respeito a `prefers-reduced-motion`.
- Navegação por Tab/Shift+Tab e suporte à Gamepad API para controles de mapeamento padrão: direcional percorre controles; A ativa; B fecha o diálogo. A consulta ao controle só roda quando há um controle conectado.
- API com validação de corpo, limite de requisições, respostas de erro, cabeçalhos de segurança e consultas SQLite parametrizadas. Nenhuma chamada a modelo externo.

### Experimente

| Mensagem | Resultado |
| --- | --- |
| `ajuda` | Lista de comandos |
| `olá` | Saudação |
| `que horas são?` ou `hora` | Horário no fuso do navegador |
| `data` | Data por extenso |
| `calcular (12 + 8) / 2` | Resultado `10` |
| `calcular 1,5 * 2` | Resultado `3` |
| `anotar revisar portfólio` | Salva a nota |
| `notas` | Lista as notas desta sessão |
| `apagar notas` | Exclui todas as notas desta sessão, sem desfazer |

A calculadora aceita números, decimais com vírgula/ponto, `+`, `-`, `*`, `/` e parênteses. Usa um parser limitado, sem `eval`, e rejeita divisão por zero, expressões inválidas e código. Não é uma calculadora científica nem apropriada para cálculos financeiros de precisão.

## Arquitetura

```text
src/
  App.tsx                 Interface, chat e preferências
  components/             Núcleo visual e diálogo acessível
  hooks/                  Captura/transcrição, síntese e controle
  lib/                    Cliente HTTP e histórico validado
  styles.css              Tailwind e estilos responsivos
server/
  index.ts                Inicialização e encerramento
  app.ts                  Fastify, validação e arquivos estáticos
  calculator.ts           Parser aritmético
  database.ts             SQLite e armazenamento de notas
  providers/
    types.ts              Contrato AssistantProvider
    local.ts              Motor local de comandos
shared/contracts.ts       Tipos de mensagem e contratos HTTP
e2e/                      Testes Playwright
.github/workflows/ci.yml   Testes e build no GitHub Actions
```

Fluxo servidor: React → `POST /api/chat` → provedor local → SQLite quando o comando usa notas → resposta em texto. `GET /api/health` verifica a API. No modo Pages: React → adaptador `src/lib/browser.ts` → o mesmo provedor em `shared/local.ts` → `localStorage`, sem requisições à API. A calculadora comum fica em `shared/calculator.ts`. O horário usa o fuso IANA informado pelo navegador, validado no backend quando há API.

`buildApp({ provider })` permite injetar outro `AssistantProvider`. Uma futura integração deve ampliar os metadados do contrato compartilhado para o novo provedor e manter credenciais, chamadas ao modelo, custos e limites no backend. Esta versão não inclui SDK de IA nem campos para chaves.

### Dados e privacidade

Os parágrafos abaixo descrevem o **modo servidor**. No modo Pages, tanto o histórico quanto as notas ficam no navegador e a conversa não é enviada ao backend. Os dois modos não compartilham notas automaticamente.

O histórico é salvo apenas no navegador (`jarvis.history.v1`). Cada mensagem é enviada ao backend para responder, mas o backend não persiste a conversa. Logs padrão de requisição não incluem o corpo da mensagem.

As **notas** ficam em `data/jarvis.sqlite`, incluindo os arquivos de WAL do SQLite, e pertencem ao UUID guardado em `jarvis.session.v1`. Copiar esse UUID possibilita acessar as notas da sessão: ele não substitui autenticação. Limpar os dados do site ou usar outro navegador cria outra sessão, sem recuperar as notas anteriores. Para removê-las antes de limpar o site, use `apagar notas`.

Não há contas, autenticação, criptografia de notas, sincronização entre dispositivos ou backup automático. Use como MVP em máquina/rede confiável; adicione autenticação e proteção de dados antes de expor a API em produção pública. Limites: 2.000 caracteres por mensagem, 100 notas por sessão, 100 mensagens locais e 60 requisições de chat por minuto/IP.

## Áudio nos navegadores

- Microfone exige `getUserMedia`, `MediaRecorder` e um contexto seguro: HTTPS ou `localhost`. Um endereço HTTP de rede doméstica normalmente não é suficiente. Permissão negada, microfone ausente e falha de captura exibem mensagens e preservam a digitação.
- O áudio gravado não é enviado à API nem salvo em disco/localStorage. Um `Blob` temporário permite reprodução nesta página e é liberado ao descartar, substituir ou sair. Codec/formato são escolhidos pelo navegador.
- `SpeechRecognition`/`webkitSpeechRecognition` variam por navegador, dispositivo, idioma e política. Chrome/Edge podem usar um serviço externo de reconhecimento, que pode exigir rede e enviar áudio ao fornecedor do navegador. A existência da API não garante funcionamento. Não há promessa de transcrição offline.
- Quando reconhecimento não está disponível, a captura pode permitir apenas ouvir a própria gravação; o pedido deve ser digitado. Ao transcrever, revise o texto e clique em enviar.
- `speechSynthesis` depende das vozes instaladas, idioma e regras de reprodução do navegador. Algumas plataformas exigem um gesto para tocar áudio e podem bloquear leitura automática; o botão “Ouvir” continua sendo uma tentativa explícita. Texto sempre permanece disponível. Leituras são limitadas aos primeiros 4.000 caracteres.
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

Vitest cobre cálculos válidos/inválidos, API real por injeção Fastify, validação, fuso, limites, persistência/reabertura SQLite, isolamento entre sessões e recuperação do histórico. Playwright exercita o frontend com a API e SQLite reais em contextos separados de desktop/celular: conversa, recarga, limpeza, notas, falha de rede, fallback de voz, permissão negada, preferências, layout/movimento reduzido, cancelamento de permissão pendente, captura/reprodução/descarte de áudio, transcrição, síntese e controle. A captura usa `MediaRecorder` real com um dispositivo de áudio sintético do Chromium; reconhecimento, síntese e gamepad são simulados. Os testes usam um banco temporário em `/tmp`, não o banco de desenvolvimento. Essas simulações não demonstram a qualidade de um microfone, uma transcrição real ou a compatibilidade física com o Xbox.

### Checklist manual no Xbox

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

1. Validar em Xbox real, Safari/iOS, Edge desktop e Android com dispositivos físicos.
2. Acrescentar autenticação, gestão de sessões, exclusão individual e backup/exportação de notas.
3. Implementar um provedor de modelo local ou integração opcional no backend, com escolha explícita do usuário e limites de consumo.
4. Expandir comandos e contexto de conversa sem prometer funções não implementadas.
5. Adicionar PWA/cache com estratégia offline — o modo servidor exige a API em execução; Pages precisa carregar os arquivos estáticos — e ampliar testes de acessibilidade com leitores de tela.

JARVIS AI é um projeto independente de portfólio. Não possui afiliação com Marvel, Microsoft ou seus produtos.
