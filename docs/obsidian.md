# Notas do Obsidian no JARVIS

Esta integração importa cópias dos arquivos Markdown para sua conta pessoal.
O JARVIS consegue recuperar trechos, responder com o modelo já configurado e
mostrar as notas consultadas. Não precisa de Obsidian Sync, chave nova ou outro
SQL no Supabase. Use o endereço do Render e sua senha pessoal existente.

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
no celular; a seleção de arquivos é o fluxo principal. Não foi configurada
sincronização entre os cofres do computador e do celular.

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

- Até cem notas e 1 MB de texto UTF-8 por conta.
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

Esta versão não escreve no cofre, gera notas novas, acompanha mudanças de arquivos,
importa ZIP/PDF/imagens, instala plugins ou sincroniza diretamente com Obsidian.
A cópia no JARVIS só acompanha novas edições após outra importação confirmada.

## Desenvolvimento e testes

```sh
npm ci
npm run dev
npm test
npm run build
E2E_PRODUCTION=1 npm run test:knowledge
```

O painel exige modo pessoal. Para testes locais próprios, configure uma senha
`JARVIS_PASSWORD` em `.env` ignorado; Supabase pode ficar vazio para usar SQLite.
Os testes automatizados usam uma senha de fixture e bancos temporários, sem
acesso à sua conta privada.

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
