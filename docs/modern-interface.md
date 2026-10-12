# Interface Moderna

Implementação baseada diretamente em [jarvis-moderno-referencia.html](reference/jarvis-moderno-referencia.html), o arquivo aprovado. O original é preservado com sua licença. O CSS, os caminhos SVG e a geometria/ruído/projeção das 1.700 partículas foram reaproveitados. Não há novo design nem ações simuladas no aplicativo.

## Revisar sem publicar

```sh
npm ci
npm run dev
```

Abra `http://localhost:5173`. A prévia completa usa o backend de desenvolvimento e preserva suas integrações configuradas. Nenhuma chave é colocada no frontend. Esta alteração não exige migração de banco, reinstalação do plugin nem mudanças de variáveis no Render.

As capturas de desktop e celular ficam em `artifacts/modern-preview`. Com o servidor de desenvolvimento aberto, gere-as com `node scripts/review-modern-interface.mjs`; o script compara as medidas e registra o intervalo entre frames no Chromium. Para gerar um HTML portátil com o aplicativo real em modo navegador:

```sh
npm run build:pages
node scripts/build-modern-preview.mjs
```

Abra `artifacts/modern-preview/jarvis-moderna-preview.html` no navegador. A exportação permite revisar a interface, usar cálculos/notas locais e a voz nativa quando o navegador permitir. Ela não inclui dados pessoais, senha, Supabase ou chaves de IA. As integrações de conta são verificadas na prévia completa e nos testes, não simuladas nesse HTML. Reconhecimento e reprodução continuam sujeitos à compatibilidade/permissões do navegador.

## Fluxos preservados

- **Conversa:** histórico real, envio por Enter, texto progressivo, cancelamento, leitura automática/reprodução manual, propostas e fontes da web/Obsidian.
- **Projetos:** criar, adicionar etapas, concluir/reabrir e arquivar/restaurar, pelas mesmas APIs com controle de revisão.
- **Tarefas:** pendências reais ordenadas pelos prazos existentes; concluir usa a API atual. Planejar prepara propostas para confirmar.
- **Memória:** perfil e memórias existentes, com edição e exclusão. Segundo cérebro/Ver minhas notas abre o Obsidian conectado; sem conta informa a indisponibilidade.
- **Nova conversa:** pede confirmação para limpar o histórico atual; preserva notas, memória e projetos. Conversas independentes com histórico separado ainda não estão implementadas.
- O indicador de conexão no canto superior abre **Preferências**, inclusive no celular. Lá ficam histórico, comandos, tipo de voz, conversa contínua, notícias opcionais e as integrações existentes.
- Os atalhos JARVIS/Prospect AI enviam pedidos ao assistente; não inventam projetos ou etapas registrados.

## Canvas e áudio

O estado vem da gravação/reconhecimento, processamento e reprodução reais. Espera mantém o movimento suave; processamento aumenta a atividade. A energia é interpolada e a fase do ruído não salta ao começar/parar a fala. Pausa e movimento reduzido congelam o Canvas sem manter um loop de frames; ocultar a página suspende o loop. Desmontar cancela o frame e desconecta o ResizeObserver/listeners.

O volume do microfone é medido apenas quando já existe um MediaStream autorizado para gravação no modo chat. O reconhecimento no modo voz não expõe PCM e não abre um segundo microfone para alimentar a animação. MP3 usa o áudio já reproduzido; se o AudioContext estiver bloqueado/indisponível, não redireciona o som para um contexto suspenso. A síntese nativa também não fornece PCM: nesses casos a esfera usa o estado real com movimento suave, sem alegar medição de volume.

## Verificação visual e funcional

`e2e/modern.spec.ts` carrega o HTML original nas mesmas dimensões da página React, fixa o ruído e pausa os movimentos. Normaliza apenas saudação, conexão e aviso de privacidade para comparar medidas, fontes, cores, bordas, espaçamentos e caminhos SVG. O CSS original não é alterado no teste. A comparação também verifica o cartão após enviar uma pergunta, usando pergunta destacada e resposta em texto como no original. As capturas usam identidade controlada de teste, sem exportar os dados da conta. Desktop usa 1440×1000; celular usa o viewport Pixel 7, e as capturas de revisão usam 390×844.

Os testes também cobrem transições ouvir/pensar/falar/interromper, permissão negada, ausência de voz, captura/reprodução de áudio, cache/cancelamento, histórico, confirmação de propostas, conta e sincronização do Obsidian. Testes unitários conferem limpeza de recursos e continuidade do movimento. Desempenho e áudio em um celular físico e no Edge do Xbox ainda precisam de conferência no aparelho.

```sh
npm test
npm run build
npm run test:e2e
E2E_PRODUCTION=1 npm run test:e2e
E2E_PRODUCTION=1 npm run test:personal
E2E_PRODUCTION=1 npm run test:projects
E2E_PRODUCTION=1 npm run test:knowledge
E2E_PRODUCTION=1 npm run test:obsidian
npm run test:pages
```

A interface foi aprovada para publicação. Use a prévia local para revisar futuras alterações antes de publicar na `main`/Render.
