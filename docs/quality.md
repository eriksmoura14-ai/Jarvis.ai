# Correções e avaliação de qualidade

As falhas relatadas em 12/10/2026 foram reproduzidas: um pedido de pesquisa sem assunto consultava palavras de cortesia, a data da OBMEP ficava restrita às notas pessoais e “sim” recuperava a palavra dentro da nota Roblox. São falhas do aplicativo antes da geração, além das limitações do modelo.

O servidor agora esclarece pedidos vazios sem consultar buscador ou IA. Uma confirmação curta acompanha o assunto da conversa ativa; nunca executa uma tarefa de uma nota. Calendários de OBMEP, ENEM e SAT têm consultas públicas separadas, limitadas respectivamente aos domínios oficiais `obmep.org.br`, `gov.br` e `collegeboard.org`. A pergunta não exige que o usuário conheça o ano: sem edição explícita usa o ano atual. O dia da prova continua dependendo de fontes que respondam à pergunta; nenhum calendário foi hardcoded.

Pesquisas de um assunto explícito usam uma chamada para resumir. Comparações e pedidos com vários assuntos ainda podem usar planejamento e até três consultas. Uma busca que falha antes de encontrar fontes não aciona o resumo. Quando há HTTP 429, chamadas seguintes respeitam `Retry-After`; sem esse cabeçalho o aplicativo faz uma pausa local de 60 segundos, sem afirmar que a cota do provedor reseta nesse prazo. A pausa é por processo; limites diários e autenticação existentes continuam ativos.

A recuperação pessoal ignora palavras de confirmação e elimina correspondências fracas em relação ao melhor resultado. Até cinco trechos continuam disponíveis; tabelas preservam linhas inteiras e repetem cabeçalhos. Uma seção posterior de atualização/correção da mesma nota acompanha a evidência antiga. Tabelas em blocos de código permanecem exemplos. Pedidos amplos sobre metas explicitamente tabuladas podem ser respondidos por extração, sem inferência. Quando existe uma retificação que supera o registro antigo, a extração é desativada e os dois trechos vão para o modelo. Isso preserva incertezas e evita interpretar uma meta como uma realização.

Nenhuma alteração migra, remove ou sobrescreve notas ou memórias. O ZIP do plugin continua sendo gerado pelo build; sincronização, lotes, backups e conflitos permanecem no fluxo existente.

## Verificações separadas

```bash
npm test
npm run build
npm run evaluate:routing
```

`evaluate:routing` executa 22 casos, sem rede nem inferência. A medição inicial foi 11/22; após as correções, 22/22. Isso mede encaminhamento e esclarecimento, **não** inteligência ou precisão geral do modelo. Os testes de API usam transportes controlados para verificar fontes, chamadas, histórico, proteção de dados e limites. Uma fonte fictícia de teste não confirma a data real da OBMEP.

Para verificar as respostas do modelo efetivamente configurado, forneça `GROQ_API_KEY`, `AI_PROVIDER=groq` e `AI_MODEL` nas variáveis seguras do backend/ambiente. Não grave valores no repositório ou no frontend. O comando é explícito e usa até seis chamadas, espaçadas, sem ElevenLabs, sem ferramentas, sem repetição de erros e sem enviar o cofre real:

```bash
npm run evaluate:model -- --live
```

Sem `--live`, não há chamadas. Sem configuração, o comando informa o bloqueio e termina com código 2. O relatório em `artifacts/quality/model-live.json` registra respostas, verificações automáticas, quantidade de chamadas e tokens informados pelo provedor; a pasta está ignorada pelo Git. Há seis sondagens com dados fictícios: metas apesar de negativa antiga, plano versus resultado, nome atual, confirmação contextual, correção posterior e data já passada. As respostas precisam de revisão humana: passar em expressões regulares não prova raciocínio correto. Uma consulta pública real e a versão atual do cofre sincronizado exigem validação adicional no aplicativo autenticado.

O aplicativo continua usando o modelo escolhido no Render; não substitui o provedor nem aumenta seu orçamento. Reduzir a temperatura para 0,2 favorece consistência, mas não elimina alucinações. Não há promessa de ausência de erros. Uma correção só deve ser anunciada como validada no modelo real depois de executar e revisar esse relatório com o modelo real.
