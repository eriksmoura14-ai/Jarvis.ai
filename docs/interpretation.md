# Interpretação de pedidos

Com IA compatível conectada, perguntas livres podem virar conversa, resposta pessoal ou pesquisa. A IA escolhe uma ação estruturada e o servidor valida e executa a busca. Não há consciência nem um novo modelo. O indicador **Pesquisa automática ativa** anuncia a capacidade configurada, sem certificar a disponibilidade do provedor.

Teste pelo computador ou celular:

- `Como posso organizar meus estudos?`: conversa, com memórias e notas pertinentes quando disponíveis.
- `Qual meu nome?`: consulta local ao perfil, sem pesquisa pública.
- `O que eu anotei sobre meu projeto Jarvis?`: resposta com trechos das suas notas pessoais.
- `O que eu já estudei sobre React no meu Obsidian?`: consulta cópias Markdown importadas e mostra referências `[N1]`; sem IA, devolve trechos reais.
- `Me explique React`, depois `no Obsidian`: muda a fonte para suas notas sobre o mesmo assunto. Sem assunto anterior, pergunta qual tema ou nota consultar.
- `notas do Obsidian`: lista títulos e caminhos reais, sem consumir IA. `notas` lista as notas rápidas do JARVIS.
- `Explique melhor`, `resuma`, `mais curto` ou `dê um exemplo`: transforma a conversa anterior, sem pesquisa pública. Um novo assunto explícito passa a ser o tema atual.
- `Quais são minhas prioridades?`: com IA, considera memórias, projetos e notas disponíveis; pode consultar notas pelo significado dos títulos. `minhas tarefas` mantém a listagem direta. `Planeje meu dia`, `O que devo fazer hoje?` e `Quais são minhas prioridades hoje?` geram o planejamento diário com dados reais, sem consumir IA.
- `Tem novidades de tecnologia e inteligência artificial hoje?`: pode solicitar até três consultas públicas complementares.
- `E o que mudou nisso hoje?`: pode continuar o último tema público pesquisado no contexto ativo da conta. Sem assunto identificável, deve pedir esclarecimento.
- `Oi Jarvis, pesquise para mim sobre a guerra na Ucrânia`: pesquisa explícita também sem IA, removendo a introdução falada e tentando alternativas quando nada foi encontrado.

O seletor **Pesquisar na web** foi removido do chat e do modo voz. Pedidos claros de notícias, preços, clima e fatos atuais disparam a pesquisa mesmo se o modelo não solicitar uma ferramenta. Perguntas pessoais e ações locais têm prioridade; assuntos ambíguos dependem do contexto ou de esclarecimento. Conversa não salva fatos automaticamente. Use `anotar <texto>`, `lembre que <informação>` ou o painel de memória para alterações. No modo pessoal, o modelo também pode propor criar projetos, adicionar tarefas ou concluir uma tarefa atual, sempre com revisão e confirmação na tela. Veja [projetos e tarefas](projects.md). Não há ferramentas para apagar dados ou controlar dispositivos.

`server/conversation.ts` usa o contexto ativo para recuperar o assunto de continuações reconhecidas e selecionar notas/projetos pertinentes. Preserva a frase original para o modelo interpretar; não transforma comandos anteriores em novas ações. Uma mudança isolada para `na web` depois de um pedido pessoal exige que você diga um tema público. A IA recebe instruções para pedir esclarecimento quando houver ambiguidade, distinguir notas de sugestões e planos de realizações. Isso melhora a interpretação, mas não torna o modelo infalível.

## Arquitetura

`HybridProvider` resolve comandos locais antes da IA. Em perguntas livres, `ModelProvider` oferece `search_web` na chamada normal Groq/Ollama. Uma resposta direta usa uma chamada. Uma solicitação de ferramenta devolve `{ queries, news }`: o servidor valida até três consultas de 300 caracteres, executa até duas em paralelo e pede um resumo em uma segunda chamada. Ambas consomem as cotas existentes de IA. Pesquisas explícitas e perguntas atuais reconhecidas também tentam planejamento com IA. Falhas de disponibilidade ou de cota conservam o assunto público da pergunta como alternativa. Uma consulta recusada pela validação pede esclarecimento; ferramentas desconhecidas não executam pesquisa. Sem modelo, fazem a busca diretamente.

`ResearchProvider` tem dez segundos para obter fontes. Se nada for encontrado, pode tentar palavras-chave diferentes dentro do teto de três consultas. Cada consulta usa os buscadores fixos disponíveis; não visita URLs indicadas pelo modelo nem baixa páginas completas. Seleciona até cinco fontes distintas distribuídas entre consultas bem-sucedidas. **Consultas realizadas** mostra os assuntos tentados. Falhas parciais são informadas; falha no resumo conserva resultados reais. Notícias exigem data nos últimos sete dias. Pesquisa geral pode usar um feed de notícias sem afirmar que os resultados são os mais recentes.

Groq SSE e Ollama NDJSON podem entregar argumentos da ferramenta em partes; esses argumentos nunca aparecem como texto da resposta. O resumo continua progressivo. O pedido completo tem 42 segundos no servidor e 45 no navegador. Cancelar interrompe pesquisa e modelo. A geração do contexto pessoal precisa coincidir antes de salvar e confirmar a resposta.

Se o streaming termina incompleto ou o provedor informa uma falha recuperável, como `tool_use_failed`, o backend tenta **uma vez** receber uma resposta completa em JSON. Mantém as mesmas ferramentas e validações; não executa chamadas presentes no texto de erro do provedor. A tentativa adicional consome as cotas de IA e pode demorar mais. Depois de recuperar, uma eventual leitura de notas também usa JSON, sem nova repetição. Erros de cota, autenticação, contexto excessivo e cancelamento não são repetidos. Uma resposta parcial não é salva como completa nem falada; erros persistentes continuam sendo informados com uma mensagem segura, sem o conteúdo privado do provedor.

## Dados pessoais e limites

O servidor autenticado recupera até cinco trechos de notas, com mil caracteres cada, ordenados por palavras pertinentes e recência. É uma seleção limitada por palavras, sem embeddings; prefira um assunto específico. `notas` continua listando notas localmente. O modelo recebe os trechos e memórias para responder, pela integração existente. Não são enviados diretamente ao buscador.

Para o Obsidian, o modelo também recebe um catálogo limitado a aproximadamente 8.000 caracteres de IDs/títulos/caminhos. A seleção prioriza títulos pertinentes e recência; bibliotecas grandes podem não caber inteiras. Nomes longos são abreviados e o modelo é informado da cobertura. O catálogo vai ao provedor de IA configurado, como os trechos e memórias; não vai ao buscador. Um título não comprova conteúdo ou progresso.

Quando os trechos por palavras não bastam, a IA pode chamar `read_notes` escolhendo até três IDs existentes do catálogo. O servidor consulta somente as cópias atuais dessas notas: até cinco trechos de 1.100 caracteres, nunca arquivos arbitrários, anexos ou URLs. Se a consulta não tiver correspondência, retorna o primeiro trecho real de cada nota escolhida. A resposta identifica as notas com `[N1]` etc. Só há uma leitura adicional por resposta; a segunda inferência não oferece ferramentas, consome as cotas de IA e mantém o cancelamento e a validação da geração pessoal. Uma pergunta simples com trechos suficientes continua usando uma chamada.

Uma ausência de correspondência por palavras não bloqueia mais o modelo com uma resposta pronta. Ele pode escolher outra nota pelo título ou fazer uma pergunta específica. Essa seleção usa a interpretação do modelo, **sem índice vetorial, embeddings ou treinamento automático com seu cofre**. Pode deixar de localizar uma informação, especialmente em bibliotecas maiores que o catálogo ou notas longas. Para ler integralmente, abra a nota pelo painel.

Consultas propostas pela IA precisam compartilhar um assunto público com a pergunta ou a última pesquisa registrada no contexto ativo. O filtro recusa termos privados do contexto/memórias/notas/projetos e da biblioteca Markdown ausentes desses assuntos, além de URLs, ferramentas desconhecidas e formatos inválidos. A separação combina instruções e filtros de palavras, sem classificação infalível. Não inclua credenciais ou dados sensíveis em pedidos de pesquisa.

Editar/apagar memórias, alterar perfil, limpar a conversa, apagar notas, alterar projetos ou importar/atualizar/excluir Markdown invalida o contexto antigo e respostas pendentes. O histórico visível pode preservar pesquisas antigas sem alimentar continuações após o reinício. Uma inferência que já recebeu dados não pode ser desfeita no provedor.

Não há novas variáveis ou migração SQL. Reutilize Groq/Ollama, senha e SQLite/Supabase existentes. Modelos sem suporte a ferramentas podem recusar perguntas livres nessa configuração; selecione um modelo compatível. Buscadores podem bloquear consultas. O comportamento real do modelo e o áudio/controle físico no celular/Xbox precisam de teste no serviço.

`npm test` cobre consultas complementares, prioridade pessoal (inclusive “quais são meus futuros objetivos”), continuidade pública/pessoal, correção de fonte, transformação de respostas, mudanças de assunto, reinício, leitura por IDs reais, limites de catálogo/cotas, ferramentas Groq/Ollama em stream, recuperação limitada de falhas, cancelamento e exclusão de notas durante resposta. Playwright cobre indicador, detalhes de consultas, histórico e layout desktop/celular. Provedores simulados não demonstram qualidade de inferência real: confira fontes, datas e comportamento na sua conta.

A [biblioteca Obsidian](obsidian.md) recupera até cinco trechos de 1.100 caracteres, no máximo dois por nota. Pedidos explícitos sobre a biblioteca e continuações reconhecidas recebem prioridade pessoal na escolha de fontes. Referências são geradas pelo backend a partir das notas reais; marcadores inexistentes são removidos da resposta final. Consultas públicas não recebem o corpus completo, mas o modelo pode receber trechos pertinentes como contexto.

## Respostas e planejamento diário

O padrão é uma resposta curta em parágrafos conectados, inclusive nos resumos com fontes. Listas, tópicos, tabelas e passo a passo podem ser solicitados explicitamente. Texto de código e tabelas não são achatados. O mesmo tratamento é aplicado ao texto progressivo e à resposta final; não há uma inferência extra só para reformatação.

No modo pessoal, o planejamento diário sugere até três passos. Prioriza tarefas com prazo registrado, no fuso do aparelho, seguidas das outras tarefas salvas, checklists de ações e tabelas explicitamente pessoais de metas. Pendências de manutenção do contexto, como preencher perguntas ou atualizar a etapa real de um projeto, ficam depois das ações e metas quando não têm prazo explícito. Essa identificação usa frases específicas; atualizar o site de um cliente ou conferir uma convocação continua sendo uma ação. A manutenção permanece disponível quando faltam outros passos e nenhuma tarefa existente é alterada.

Ignora exemplos em código, linhas concluídas/canceladas e tarefas já registradas, inclusive concluídas. Dentro dessas categorias, mantém os prazos/ordem de criação das tarefas e a ordem dos caminhos das notas. Isso é uma regra de seleção, não uma avaliação completa de importância. Uma meta gera uma sugestão para definir seu próximo passo, sem inventar realização, prazo ou duração. As fontes são trechos reais com referências. O plano usa frases conectadas e identifica a sugestão uma vez, sem copiar rótulos e pontuação das notas na fala.

Passos novos vão para uma proposta de criar ou completar o projeto “Plano diário”. A confirmação na tela salva; pedir planejamento não altera notas nem tarefas. Alterações nas fontes invalidam a proposta antiga. Faltando dados, pede o objetivo que você quer priorizar. Outros pedidos pessoais continuam podendo consultar o modelo e o catálogo de notas.
