# Interpretação de pedidos

Com IA compatível conectada, perguntas livres podem virar conversa, resposta pessoal ou pesquisa. A IA escolhe uma ação estruturada e o servidor valida e executa a busca. Não há consciência nem um novo modelo. O indicador **Pesquisa automática ativa** anuncia a capacidade configurada, sem certificar a disponibilidade do provedor.

Teste pelo computador ou celular:

- `Como posso organizar meus estudos?`: conversa, com memórias e notas pertinentes quando disponíveis.
- `Qual meu nome?`: consulta local ao perfil, mesmo com a opção web marcada.
- `O que eu anotei sobre meu projeto Jarvis?`: resposta com trechos das suas notas pessoais.
- `O que eu já estudei sobre React no meu Obsidian?`: consulta cópias Markdown importadas e mostra referências `[N1]`; sem IA, devolve trechos reais.
- `Tem novidades de tecnologia e inteligência artificial hoje?`: pode solicitar até três consultas públicas complementares.
- `E o que mudou nisso hoje?`: pode continuar o último tema público pesquisado no contexto ativo da conta. Sem assunto identificável, deve pedir esclarecimento.
- `Oi Jarvis, pesquise para mim sobre a guerra na Ucrânia`: pesquisa explícita também sem IA, removendo a introdução falada e tentando alternativas quando nada foi encontrado.

Não precisa marcar **Pesquisar na web** para perguntas livres com IA. Essa opção força a pesquisa de um assunto público; comandos de notas e perguntas pessoais reconhecidas têm prioridade. Conversa não salva fatos automaticamente. Use `anotar <texto>`, `lembre que <informação>` ou o painel de memória para alterações. No modo pessoal, o modelo também pode propor criar projetos, adicionar tarefas ou concluir uma tarefa atual, sempre com revisão e confirmação na tela. Veja [projetos e tarefas](projects.md). Não há ferramentas para apagar dados ou controlar dispositivos.

## Arquitetura

`HybridProvider` resolve comandos locais antes da IA. Em perguntas livres, `ModelProvider` oferece `search_web` na chamada normal Groq/Ollama. Uma resposta direta usa uma chamada. Uma solicitação de ferramenta devolve `{ queries, news }`: o servidor valida até três consultas de 300 caracteres, executa até duas em paralelo e pede um resumo em uma segunda chamada. Ambas consomem as cotas existentes de IA. Pesquisas explícitas ou com a opção web marcada também tentam planejamento com IA; se essa etapa falha ou não propõe consultas válidas, conservam o assunto explícito como alternativa. Sem modelo, fazem a busca diretamente.

`ResearchProvider` tem dez segundos para obter fontes. Se nada for encontrado, pode tentar palavras-chave diferentes dentro do teto de três consultas. Cada consulta usa os buscadores fixos disponíveis; não visita URLs indicadas pelo modelo nem baixa páginas completas. Seleciona até cinco fontes distintas distribuídas entre consultas bem-sucedidas. **Consultas realizadas** mostra os assuntos tentados. Falhas parciais são informadas; falha no resumo conserva resultados reais. Notícias exigem data nos últimos sete dias. Pesquisa geral pode usar um feed de notícias sem afirmar que os resultados são os mais recentes.

Groq SSE e Ollama NDJSON podem entregar argumentos da ferramenta em partes; esses argumentos nunca aparecem como texto da resposta. O resumo continua progressivo. O pedido completo tem 42 segundos no servidor e 45 no navegador. Cancelar interrompe pesquisa e modelo. A geração do contexto pessoal precisa coincidir antes de salvar e confirmar a resposta.

## Dados pessoais e limites

O servidor autenticado recupera até cinco trechos de notas, com mil caracteres cada, ordenados por palavras pertinentes e recência. É uma seleção limitada por palavras, sem embeddings; prefira um assunto específico. `notas` continua listando notas localmente. O modelo recebe os trechos e memórias para responder, pela integração existente. Não são enviados diretamente ao buscador.

Consultas propostas pela IA precisam compartilhar um assunto público com a pergunta ou a última pesquisa registrada no contexto ativo. O filtro recusa termos privados do contexto/memórias/notas/projetos e da biblioteca Markdown ausentes desses assuntos, além de URLs, ferramentas desconhecidas e formatos inválidos. A separação combina instruções e filtros de palavras, sem classificação infalível. Não inclua credenciais ou dados sensíveis em pedidos de pesquisa.

Editar/apagar memórias, alterar perfil, limpar a conversa, apagar notas, alterar projetos ou importar/atualizar/excluir Markdown invalida o contexto antigo e respostas pendentes. O histórico visível pode preservar pesquisas antigas sem alimentar continuações após o reinício. Uma inferência que já recebeu dados não pode ser desfeita no provedor.

Não há novas variáveis ou migração SQL. Reutilize Groq/Ollama, senha e SQLite/Supabase existentes. Modelos sem suporte a ferramentas podem recusar perguntas livres nessa configuração; selecione um modelo compatível. Buscadores podem bloquear consultas. O comportamento real do modelo e o áudio/controle físico no celular/Xbox precisam de teste no serviço.

`npm test` cobre consultas complementares, prioridade pessoal, continuidade pública, reinício, ferramentas Groq/Ollama, cancelamento e exclusão de notas durante resposta. Playwright cobre indicador, detalhes de consultas, histórico e layout desktop/celular. Provedores simulados não demonstram qualidade de inferência real: confira fontes, datas e comportamento na sua conta.

A [biblioteca Obsidian](obsidian.md) recupera até cinco trechos de 1.100 caracteres, no máximo dois por nota. Pedidos explícitos sobre a biblioteca e continuações reconhecidas recebem prioridade pessoal sobre a opção web. Referências são geradas pelo backend a partir das notas reais; marcadores inexistentes são removidos da resposta final. Consultas públicas não recebem o corpus completo, mas o modelo pode receber trechos pertinentes como contexto.
