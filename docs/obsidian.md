# Notas do Obsidian no JARVIS

A biblioteca pode receber cópias por importação manual ou acompanhar um cofre
pelo plugin JARVIS para Obsidian. O assistente consulta trechos com referências
reais; o painel também permite editar uma nota e devolvê-la ao cofre quando você
autoriza escrita no plugin. **Instalar e vincular o plugin é uma ação manual no
seu aparelho**: o site não obtém acesso ao Obsidian apenas por abrir a biblioteca.
Não precisa de Obsidian Sync pago, outro SQL ou novas variáveis no Render.
Use sua conta JARVIS pessoal existente, com senha e Supabase já configurados.

## Conectar o cofre do Android

1. Faça um backup externo do cofre antes do primeiro teste. No JARVIS do Render,
   entre e abra **Notas do Obsidian → Conectar Obsidian do Android**.
2. Baixe `jarvis-obsidian.zip`. No gerenciador de arquivos, mostre arquivos
   ocultos e extraia a pasta `jarvis-obsidian` em
   `<seu-cofre>/.obsidian/plugins/`. O resultado deve conter diretamente
   `manifest.json`, `main.js` e `styles.css` em `plugins/jarvis-obsidian/`,
   sem uma pasta duplicada. O plugin também funciona no Obsidian de computador.
3. Obsidian → Configurações → Plugins da comunidade: permita plugins e habilite
   **JARVIS — Cofre pessoal**. Reinicie o aplicativo se o plugin ainda não
   aparecer. Ele é próprio deste projeto e **não está no catálogo da comunidade**.
4. No painel JARVIS, dê um nome ao aparelho e **Gere a chave de vinculação**.
   Ela aparece uma vez: copie para as configurações do plugin. Não envie no chat.
   Use o endereço `https://jarvis-ai-dwqp.onrender.com`, sem caminhos.
5. Escolha uma pasta relativa, como `02 Estudos`, ou deixe vazio para o cofre
   inteiro. Comece com uma pasta pequena e notas sem dados sensíveis. Ative
   **Ativar sincronização** e toque em **Sincronizar**.
6. Confira as notas no JARVIS. Experimente perguntar sobre uma delas. A primeira
   carga pode levar vários ciclos: até 20 notas/250 KB por ciclo, a cada 30 segundos
   e cinco segundos depois de alterações. O plugin informa o resultado.
7. Para gravar no Obsidian alterações feitas pelo JARVIS, habilite também
   **Receber alterações do JARVIS**. Ela começa desligada. Abra uma nota no
   navegador, escolha **Editar nota**, revise e **Salvar nota**; deixe o Obsidian
   ativo até confirmar o recebimento.

O Xbox usa o site JARVIS e sua conta, sem instalar o Obsidian. As edições chegam
no celular quando o plugin estiver ativo. **Não há serviço Android em segundo
plano garantido**: o sistema pode suspender o aplicativo, e é necessário reabri-lo.
A lista de chaves autorizadas não é um indicador de conexão ou presença online.

O Android precisa permitir ao gerenciador de arquivos acessar a pasta do cofre.
Se a pasta escolhida estiver inacessível, escolha no próprio Obsidian uma pasta
acessível e mova/copie o cofre com backup; não apague o original antes de conferir.
Instalar o plugin ainda depende da versão do aplicativo e das permissões do seu
celular. Não foi feita instalação remota no seu aparelho.

## Atualizar para o plugin 0.1.1

Esta versão amplia a biblioteca para 1.000 notas e 10 MB (10.000.000 bytes)
de texto UTF-8 por conta. O limite por nota continua em 50 KB e o envio continua
em lotes de até 20 notas/250 KB. Um cofre grande precisa de vários ciclos;
não é enviado em uma única requisição.

Baixe novamente o ZIP pelo JARVIS. Feche o Obsidian e substitua somente
`main.js`, `manifest.json` e `styles.css` dentro de
`.obsidian/plugins/jarvis-obsidian`. Preserve `data.json`, que contém as
configurações, a chave e os hashes anteriores, e preserve `.jarvis-backups` e
todas as suas notas. Reabra o Obsidian, confira a versão 0.1.1 e sincronize.
Não é necessário gerar outra chave. Se um conflito de limite antigo ainda
aparecer, use **Tentar novamente** depois de atualizar o servidor e o plugin.

O servidor mantém o documento privado existente, os IDs e as revisões das
notas; não há exclusão, reimportação obrigatória ou migração SQL. A lista de
hashes conhecidos suporta 1.000 caminhos. A requisição de sincronização aceita
até 2 MB de JSON para acomodar esses caminhos e os escapes do lote de texto,
mantendo o limite real de conteúdo enviado em 250 KB. Importações manuais
continuam com requisições de até 800 KB de JSON e edições com até 350 KB.

A leitura e a escrita do adaptador Supabase permitem até 32 MB de JSON,
incluindo escapes, metadados, histórico, memórias e projetos. Esse teto de
transporte não amplia o limite de 10 MB de texto da biblioteca. Escritas retornam
somente a versão, preservando a comparação de versões entre aparelhos. SQLite
e a coluna JSONB do SQL existente não impõem o antigo teto de 100 notas/1 MB.
Os limites de notas rápidas e de histórico são separados e continuam iguais.

Os testes cobrem envio de 1.000 notas/10 MB, preservação de 100 cópias antigas,
reinício com todos os hashes, leitura/escrita de texto escapado no adaptador
Supabase, limite das requisições, backups e conflitos após a nota 100. Um teste
de navegador importa 121 notas em lotes e abre a última nota no painel.
O teste Supabase usa transporte simulado; a instalação no Android e a
sincronização da conta real precisam de verificação manual.

## Conflitos e backups

O plugin registra um hash SHA-256 do último texto confirmado. Envia uma edição
somente se a cópia remota ainda corresponder ao hash anterior. Na primeira
conexão, um caminho já existente com texto diferente gera conflito, sem escolher
silenciosamente uma versão. Mudar endereço, chave ou pasta pausa a conexão e exige
ativar novamente depois de conferir o novo escopo. Se os textos forem iguais, apenas vincula a nota.
Diferenças de BOM e CRLF são normalizadas para comparar; não alteram uma nota
local durante mero envio.

Quando houver conflito, abra as configurações do plugin → **Comparar**. Leia as
versões completas e confirme **Obsidian** ou **JARVIS**. O servidor verifica outra
vez a versão remota ao receber uma escolha local. Para adotar a versão remota,
o plugin verifica novamente o conteúdo local dentro de `Vault.process`.
Uma edição ocorrida durante a rede ou a gravação é preservada.

Antes de substituir um arquivo do cofre, grava seu texto original exato em
`.jarvis-backups/<data>-<id>.md`, com o caminho de origem em um `.md.json` ao lado.
Ao escolher sobrescrever a versão JARVIS num conflito, também guarda o texto
remoto nessa pasta antes do envio. Se não conseguir criar o backup, não substitui
a nota. Para restaurar, compare o arquivo de backup e copie seu texto à nota
correta com o Obsidian fechado para sincronização. Backups não são enviados nem
apagados automaticamente; faça cópias externas e monitore o espaço do celular.

**Exclusões não se propagam em nenhuma direção.** Uma nota removida da conta
fica no celular; uma nota apagada do celular mantém a cópia na conta. Renomear
cria outro caminho na biblioteca e preserva o antigo, que pode ser removido
manualmente depois da conferência. Não sincroniza novos arquivos criados somente
na conta para dentro do cofre: o editor web altera notas existentes. Não execute
outro sincronizador nas mesmas notas enquanto testa esta conexão.

Cada ciclo pode confirmar algumas notas e recusar outras por conflito ou limite;
parte válida é salva, e o plugin mantém os conflitos para revisão. Essa operação
é diferente da importação manual abaixo, em que um lote conflitante é recusado
inteiro. Falha de rede tem nova tentativa, sem escolher outra versão às cegas.

## Chaves e privacidade da conexão

A chave é gerada no backend após login, mostrada uma vez e guardada no celular
em `.obsidian/plugins/jarvis-obsidian/data.json`. Não compartilhe esse arquivo,
nem inclua configurações do plugin em um cofre público. O servidor guarda apenas
o hash da chave, com validade de 180 dias. Até cinco chaves por conta.
**Revogar** no painel bloqueia os próximos pedidos daquele plugin; trocar
`JARVIS_PASSWORD` invalida todas as chaves e sessões anteriores.

A chave autoriza exclusivamente `/api/obsidian/sync` para a biblioteca Markdown.
Não é sua senha nem uma chave Supabase/Groq/ElevenLabs, e não dá acesso à API do
chat, histórico, perfil, memórias, voz ou gerenciamento de outros aparelhos.
Não compartilhe a chave: quem a obtiver poderá tentar acessar/alterar notas pela
API de sincronização. O plugin usa HTTPS e o transporte nativo `requestUrl` do
Obsidian; o servidor mantém a proteção de origem e exige `X-Jarvis-Client: 1`.
Não são adicionadas permissões CORS para sites externos.

As notas continuam no documento privado SQLite/Supabase; não há criptografia
adicional de ponta a ponta. O plugin envia só Markdown na pasta escolhida,
ignorando anexos, arquivos ocultos, vazios, inválidos ou maiores que 50 KB.
Não inclua credenciais ou dados que não queira enviar à sua conta e ao provedor
de IA quando trechos forem consultados. O texto completo não fica no localStorage
do navegador nem vai ao GitHub/Pages. Os backups são locais e privados.

## Editar no navegador

Abra a nota e use **Editar nota → Salvar nota**. Salvar altera a biblioteca da
conta, sem escrever instantaneamente no arquivo Android. O plugin, quando ativo
e autorizado a receber mudanças, realiza a gravação com backup.

O editor exige a revisão que você abriu. Se outra sessão editar antes de salvar,
a API retorna conflito, preservando o rascunho na tela e mostrando a versão atual.
Compare os textos, descarte/recomece a edição para usar a revisão atual, e copie
seu rascunho antes de fechar ou recarregar a página. Não há autosave nem cache
privado do rascunho no navegador.

## Primeira importação

1. No Obsidian, crie ou escolha algumas notas sobre um assunto real, como
   estudos de React. As notas do cofre são arquivos `.md`; você pode encontrá-las
   pelo gerenciador de arquivos do aparelho.
2. No JARVIS, abra **Notas do Obsidian → Selecionar notas Markdown**. No
   computador, também há seleção de pasta quando o navegador permitir.
3. Confira a lista, os caminhos e a prévia do texto. **Confirmar importação**
   salva o lote na conta. **Descartar seleção** não envia os arquivos ao servidor.
4. Peça `O que eu já estudei sobre React no meu Obsidian?`, ou use
   **Buscar nas notas importadas** para localizar trechos sem chamar a IA.

No celular, o seletor precisa conseguir acessar os arquivos do cofre ou cópias
exportadas para uma pasta acessível. O navegador não acessa automaticamente os
dados internos do aplicativo Obsidian. Selecionar uma pasta pode não funcionar
no celular; a seleção de arquivos é o fluxo principal. Sem o plugin, o fluxo de arquivos é manual. Esta conexão compartilha a biblioteca
JARVIS; não substitui um sincronizador geral entre vários cofres Obsidian.

Importar pelo computador já permite consultar essas cópias pelo JARVIS do
celular: entre na mesma conta, pelo mesmo endereço. O painel sincroniza ao
voltar para a aba e a cada dez segundos visível. O conteúdo completo de uma
nota é carregado somente ao abri-la; a lista inicial contém metadados.

## Atualizar ou remover cópias

Após editar no Obsidian, selecione novamente os arquivos e revise a importação.
Para substituir texto alterado, marque **Atualizar também as cópias com o mesmo
caminho**. Sem essa escolha, o lote conflitante é recusado inteiro. Texto idêntico
não cria outra cópia nem altera a versão da biblioteca. Um lote falho não salva
parte das notas.

Os caminhos identificam as cópias, ignorando diferença entre maiúsculas/minúsculas
e normalizando Unicode. Seleção de pasta preserva as subpastas abaixo da raiz
selecionada; arquivos avulsos usam somente o nome. Confira o caminho antes de
confirmar, inclusive ao importar por outro aparelho. Ele pode ser ajustado na
revisão. Notas de pastas diferentes com o mesmo nome precisam de caminhos
distintos, como `Estudos/React.md` e `Projetos/React.md`.

Uma revisão antiga da biblioteca não sobrescreve uma alteração de outro aparelho.
Depois do conflito, confira a lista atual e autorize a atualização novamente.

**Remover cópia** pede confirmação e remove somente a nota importada da conta.
O arquivo original permanece no Obsidian. Suas referências/trechos estruturados
são retirados do histórico, mas respostas antigas podem conter texto da nota.
Use **Limpar conversa** para remover esse histórico também. Backups do provedor
e dados já enviados ao modelo seguem as políticas desses serviços.

## Consulta e referências

A busca separa o Markdown em trechos por seção e tamanho, compara palavras do
pedido com títulos, caminhos, cabeçalhos e texto, e favorece termos menos comuns.
Recupera até cinco trechos de aproximadamente 1.100 caracteres, com até dois por
nota. Prioriza notas diferentes antes de incluir um segundo trecho. Não há
embeddings, busca por significado, grafo ou leitura completa do cofre.

Nomeie o assunto ou a nota: sinônimos sem palavras em comum podem não encontrar
resultados. Continuações como `E como isso ajuda meu projeto?` podem reutilizar
o assunto da última pergunta explícita sobre a biblioteca no contexto ativo.
Importar alterações, remover notas ou reiniciar o contexto interrompe essa
continuidade e invalida respostas antigas em andamento.

Com IA, os trechos recuperados são enviados ao modelo configurado, com
referências `[N1]`, `[N2]` etc. **Notas consultadas** mostra os trechos fornecidos
para a resposta, com caminho, seção e botão para abrir a cópia. Isso permite
verificar a resposta; não prova que toda afirmação do modelo é sustentada.
Referências desconhecidas não viram fontes. Abrir uma nota atualizada depois da
resposta informa que a cópia mudou.

Sem IA, pedidos explícitos sobre a biblioteca mostram os trechos reais, sem
fabricar um resumo. `minhas notas do Obsidian` lista até vinte notas sem IA;
o painel mostra a biblioteca completa. Uma pergunta explícita sem trechos
pertinentes informa a ausência, sem fingir que consultou a web. Esses pedidos
têm prioridade sobre a opção **Pesquisar na web**. Perguntas comuns também podem
receber trechos pertinentes como contexto do modelo.

O título vem do primeiro cabeçalho de nível um fora de blocos de código, ou do
nome do arquivo. Frontmatter é preservado no original importado, mas removido dos
trechos. Wikilinks têm seu alias ou alvo representado como texto; não são
seguidos para baixar outras notas. Anexos, links e imagens não são baixados;
pastas ocultas, incluindo `.obsidian`, são ignoradas pelo seletor. A visualização
do arquivo usa texto Markdown, sem executar HTML, scripts ou plugins.

## Dados e limites

- Até 1.000 notas e 10 MB de texto UTF-8 por conta.
- Até vinte arquivos e 250 KB por importação; até 50 KB por nota.
- Somente `.md` UTF-8 não vazio. Caminhos ocultos, absolutos, repetidos ou com
  `..`, barras invertidas, dois-pontos e caracteres de controle são recusados.
- Dez tentativas de importação por minuto/IP; cotas de IA existentes continuam
  valendo. Ler, importar e buscar trechos no painel não usa modelo.

Conteúdo e referências ficam no backend pessoal SQLite/Supabase. As notas não
são gravadas em localStorage nem publicadas no GitHub Pages. Seleções e notas
abertas ficam na memória da página. Trechos pertinentes podem acompanhar
perguntas ao modelo, incluindo planejamento/resumo, conforme a integração de IA.
O filtro de pesquisas considera o texto de toda a biblioteca para recusar termos
privados fora do assunto público permitido. Esse filtro por palavras não é uma
garantia de classificação infalível: não importe credenciais e não coloque
informações privadas em pedidos de pesquisa.

Não há geração automática de novas notas, embeddings, anexos ou importação de
ZIP/PDF/imagens. O plugin acompanha alterações e devolve edições autorizadas;
o assistente não decide sozinho escrever no cofre nem instala o plugin por você.

## Desenvolvimento e testes

```sh
npm ci
npm run build
npm run dev
npm test
E2E_PRODUCTION=1 npm run test:knowledge
E2E_PRODUCTION=1 npm run test:obsidian
```

O painel exige modo pessoal. Para testes locais próprios, configure uma senha
`JARVIS_PASSWORD` em `.env` ignorado; Supabase pode ficar vazio para usar SQLite.
Os testes automatizados usam uma senha de fixture e bancos temporários, sem
acesso à sua conta privada.

O build gera o ZIP instalável em `dist/downloads/jarvis-obsidian.zip` e a pasta
em `dist-obsidian/jarvis-obsidian`. `npm run build:obsidian` recompila só o plugin.
O download no desenvolvimento usa o proxy `/downloads`; compile uma vez antes.

Vitest verifica autorização, limites, reimportação, versões, atualização atômica,
persistência SQLite/Supabase controlado, recuperação de uma seção distante,
referências reais, privacidade da pesquisa e alteração durante resposta.
Playwright verifica seleção/revisão/descarte, leitura segura, ausência de cache
privado, sincronização entre duas sessões, atualização autorizada, conflito,
referências no chat/voz e remoção, em desktop e mobile Chromium.

Teste manualmente seu seletor de arquivos no Android/iOS, notas reais e respostas
do modelo, transcrição/áudio e retorno à aba. No Xbox Edge, seleção de arquivos
pode ser limitada: importe no computador/celular e teste a consulta, foco,
direcional/A/B e abertura de notas no console. Testes simulados não validam
esses dispositivos nem a qualidade de uma inferência real.

Os testes da conexão verificam escopo/revogação/expiração das chaves, hashes,
conflitos sem sobrescrita, confirmação da edição web, ausência de propagação de
exclusões, proteção contra resposta remota malformada, falha de backup e edição
durante `Vault.process`, por meio de adaptadores controlados. Playwright cobre
vinculação/revogação e rascunho conflitante em desktop/mobile. Não substituem
um teste no aplicativo Obsidian real.

Checklist manual Android/Xbox: instalar e habilitar plugin, parear com sua conta,
conferir o primeiro lote, editar nos dois lados, resolver conflito e restaurar
um backup; revogar a chave e confirmar o bloqueio; fechar/reabrir Obsidian e
testar retomada; no Xbox, foco, controle direcional e teclado do editor. Sem
esses testes, não há confirmação de funcionamento no seu dispositivo.
