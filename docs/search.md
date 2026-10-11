# Pesquisa na web para uso pessoal

O backend consulta resultados públicos sem uma chave de busca adicional. Nas buscas comuns tenta o HTML do DuckDuckGo, o RSS do Bing e, como alternativa, o RSS do Bing Notícias. Pedidos de notícias usam primeiro o RSS do Bing Notícias; o fallback DuckDuckGo solicita a última semana. Não há cadastro, cartão nem assinatura de busca no projeto. Essas interfaces não são APIs com disponibilidade garantida: podem mudar, limitar consultas ou exibir desafios. O JARVIS não tenta contornar desafios nem redirecionamentos; mostra um erro se não conseguir resultados reais.

## Como usar

- Diga ou escreva `Jarvis, pesquise notícias de tecnologia`.
- Também pode falar naturalmente: `Oi, Jarvis pesquisa pra mim notícias sobre a guerra na Ucrânia`. A busca retira a saudação, o nome do assistente e expressões como `pra mim`/`por favor`. Pedidos com verbos explícitos funcionam mesmo com **Pesquisar na web** desligado. Com IA compatível, perguntas livres também podem gerar pesquisas complementares; veja [interpretação](interpretation.md).
- Também aceita `pesquisar na web <assunto>`, `busque <assunto>` e `procure <assunto>`.
- Ou ative **Pesquisar na web** e envie o assunto público. Comandos de notas e perguntas pessoais reconhecidas têm prioridade. Outros textos, como `hora`, viram consultas enquanto a opção estiver ativa.
- Abra as fontes abaixo da resposta para conferir os detalhes. Os links também ficam no histórico e no modo voz. A leitura falada usa somente o texto da resposta.

O backend atualizado informa `webSearch: { enabled: true }` em `/api/health`. Isso anuncia suporte à pesquisa, não garante que os buscadores estejam acessíveis naquele momento. No Render, o campo `revision` identifica o commit em execução quando a plataforma fornece `RENDER_GIT_COMMIT`. O Pages precisa de um backend conectado; sozinho não pesquisa na web.

O servidor devolve até cinco fontes, com título, endereço e trecho do resultado. Não baixa nem lê a página completa. Se a IA estiver configurada, recebe os trechos para criar um resumo com referências `[1]`, `[2]` etc. Os links são selecionados pelo backend a partir da busca, nunca gerados pelo modelo. Sem IA ou se o resumo falhar, os resultados reais continuam disponíveis. Se a busca falhar, não há resumo nem fontes inventadas.

Antes de chamar a IA, um filtro compara os termos do assunto com os títulos e trechos. Ignora palavras comuns e reconhece equivalências de tecnologia e inteligência artificial em português/inglês, incluindo `IA` como palavra inteira. `Bahrain` não corresponde a `IA`. Isso é um filtro de palavras, não uma avaliação semântica completa: pode rejeitar fontes pertinentes com vocabulário diferente ou aceitar coincidências. Fontes descartadas não ocupam os cinco lugares nem entram no resumo.

Pedidos com `notícias`, `news` ou `manchetes` buscam notícias datadas nos últimos sete dias. O backend expande `IA` para `inteligência artificial` na consulta ao buscador e remove a introdução “últimas notícias”, preservando o assunto original na resposta. Exclui notícias sem data reconhecida, antigas ou futuras; pode não encontrar notícias mesmo que existam. A interface mostra **Publicado em** com a data informada pelo feed, separada da data da consulta. Links de rastreamento do Bing Notícias são convertidos em URLs públicas diretas, sem visitar o destino. A data do feed não é verificada na página do artigo.

No modo voz, uma pesquisa em andamento ou com erro não exibe a resposta/fontes anteriores como se fossem do pedido atual. O histórico permanece disponível e o pedido com falha retorna à digitação. Texto parcial de uma resposta com erro é descartado e não é falado.

## Privacidade e limites

A pesquisa envia apenas os assuntos das consultas ao buscador. Planejamento e resumo podem enviar a pergunta, contexto recente, memórias e seleções de notas/projetos à Groq/Ollama; o resumo inclui os resultados. A chave Groq fica somente no backend e não acompanha consultas ao buscador. Sem modo pessoal, o histórico fica no navegador. Com senha e modo pessoal, os pedidos e respostas confirmados, inclusive fontes, ficam no backend da conta e sincronizam entre aparelhos. Não coloque senhas nem informações privadas no assunto de uma pesquisa. Veja os filtros e limites em [interpretação](interpretation.md).

São no máximo 300 caracteres por assunto, três consultas por pedido, cinco fontes diferentes, dois pedidos de pesquisa simultâneos e seis pedidos por minuto no servidor inteiro. Falhas também contam. As consultas compartilham dez segundos, incluindo alternativas de buscador e uma possível reformulação por palavras-chave. Cada buscador tem até 4,5 segundos; cada chamada de IA tem 15 segundos. Pesquisa automática pode consumir uma chamada para interpretação e outra para resumo, dentro das cotas existentes. O pedido inteiro tem 42 segundos no servidor e 45 no navegador. Interromper cancela busca e resumo. Resumos pedem até quatro frases curtas. Nos modelos GPT-OSS 20B/120B da Groq, a chamada usa esforço de raciocínio baixo e até 1.024 tokens de conclusão, incluindo raciocínio; os demais mantêm 700. Uma resposta encerrada pelo limite recebe um aviso explícito.

Títulos e trechos são dados externos não confiáveis. O prompt manda ignorar instruções presentes neles, sem executar código ou ferramentas. A IA ainda pode errar; citar um link não prova a afirmação. A data da consulta não é a publicação do artigo; quando disponível, a data de publicação aparece separadamente. Não há garantia de resultados exaustivos, corretos ou relevantes, nem de preços, notícias ou outros dados em tempo real.

## Executar sem publicar

```bash
npm ci
npm run build
npm start
```

Não é necessário publicar no GitHub Pages para usar o projeto. O modo servidor entrega a interface e a API juntos. O navegador do celular precisa alcançar o servidor, e voz normalmente exige HTTPS. A instalação local não usa automaticamente a chave guardada no Render: para resumo local, configure seu `.env` ignorado ou execute sem IA, com a lista de resultados.

Para acessar tanto no computador quanto no celular, abra o mesmo endereço HTTPS do serviço Render nos dois navegadores. Isso não exige instalar o projeto em cada dispositivo. Com o modo pessoal configurado, histórico, notas e memórias sincronizam pela conta. Preferências de voz/interface continuam locais. Veja [configuração pessoal](personal.md).

A publicação no GitHub Pages agora é manual pelo workflow **Publish GitHub Pages → Run workflow**. Enviar alterações para `main` mantém a validação de CI e pode acionar o deploy do serviço Render configurado nessa branch, sem iniciar uma nova publicação automática no Pages.

Uso pessoal é diferente de acesso privado: configure `JARVIS_PASSWORD` no backend para proteger as APIs e os dados da conta. A pesquisa usa a autenticação existente; não adiciona uma segunda conta. O UUID da sessão e o CORS não substituem senha.

## Validação

`npm test` verifica extração HTML/RSS, bloqueios, fallback, limites, cancelamento, roteamento de comandos, resumo com fontes reais e descarte de links inseguros. Os testes usam respostas controladas dos buscadores/modelo; eles não confirmam disponibilidade dos serviços externos. Os testes Playwright verificam uso no desktop/celular, modo voz, histórico, links e tratamento de falhas.

Para verificar a instalação real, envie `pesquise documentação oficial React`, abra as fontes e confirme que correspondem ao assunto. Depois tente uma pergunta atual e confira a data nas páginas. Um health check ou build bem-sucedido não confirma uma consulta externa real.
