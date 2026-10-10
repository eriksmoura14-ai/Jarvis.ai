# Pesquisa na web para uso pessoal

O backend consulta resultados públicos sem uma chave de busca adicional. Usa o HTML público do DuckDuckGo e, se ele não responder, o RSS público do Bing. Não há cadastro, cartão nem assinatura de busca no projeto. Essas interfaces não são APIs com disponibilidade garantida: podem mudar, limitar consultas ou exibir desafios. O JARVIS não tenta contornar desafios nem redirecionamentos; mostra um erro se não conseguir resultados reais.

## Como usar

- Diga ou escreva `Jarvis, pesquise notícias de tecnologia`.
- Também aceita `pesquisar na web <assunto>`, `busque <assunto>` e `procure <assunto>`.
- Ou ative **Pesquisar na web** e envie o assunto. Enquanto a opção estiver ativa, a mensagem vira uma consulta, mesmo se for um comando como `hora`. Desative para voltar aos comandos/conversa comuns.
- Abra as fontes abaixo da resposta para conferir os detalhes. Os links também ficam no histórico e no modo voz. A leitura falada usa somente o texto da resposta.

O backend atualizado informa `webSearch: { enabled: true }` em `/api/health`. Isso anuncia suporte à pesquisa, não garante que os buscadores estejam acessíveis naquele momento. No Render, o campo `revision` identifica o commit em execução quando a plataforma fornece `RENDER_GIT_COMMIT`. O Pages precisa de um backend conectado; sozinho não pesquisa na web.

O servidor devolve até cinco fontes, com título, endereço e trecho do resultado. Não baixa nem lê a página completa. Se a IA estiver configurada, recebe os trechos para criar um resumo com referências `[1]`, `[2]` etc. Os links são selecionados pelo backend a partir da busca, nunca gerados pelo modelo. Sem IA ou se o resumo falhar, os resultados reais continuam disponíveis. Se a busca falhar, não há resumo nem fontes inventadas.

## Privacidade e limites

A pesquisa envia apenas o assunto ao buscador. O resumo envia os trechos dos resultados e o contexto recente à Groq/Ollama. A chave Groq fica somente no backend e não acompanha consultas ao buscador. O histórico, inclusive fontes, fica no navegador; o backend não persiste consultas. Não coloque senhas nem informações privadas no assunto de uma pesquisa.

São no máximo 300 caracteres por assunto, cinco resultados, duas pesquisas simultâneas e seis tentativas por minuto no servidor inteiro. Tentativas que falham também contam no limite por minuto. Cada buscador tem até 4,5 segundos; o resumo mantém o limite de 15 segundos e o orçamento diário de IA existente. O navegador aguarda até 30 segundos. Interromper a conversa cancela também a busca/resumo. Resumos pedem até quatro frases curtas. Nos modelos GPT-OSS 20B/120B da Groq, a chamada usa esforço de raciocínio baixo e até 1.024 tokens de conclusão, incluindo raciocínio; os demais mantêm 700. Uma resposta encerrada pelo limite recebe um aviso explícito.

Títulos e trechos são dados externos não confiáveis. O prompt manda ignorar instruções presentes neles, sem executar código ou ferramentas. A IA ainda pode errar; citar um link não prova a afirmação. A data mostrada é a da consulta, não a publicação do artigo. Não há garantia de resultados exaustivos, atualizados ou relevantes, nem de preços, notícias ou outros dados em tempo real.

## Executar sem publicar

```bash
npm ci
npm run build
npm start
```

Não é necessário publicar no GitHub Pages para usar o projeto. O modo servidor entrega a interface e a API juntos. O navegador do celular precisa alcançar o servidor, e voz normalmente exige HTTPS. A instalação local não usa automaticamente a chave guardada no Render: para resumo local, configure seu `.env` ignorado ou execute sem IA, com a lista de resultados.

Para acessar tanto no computador quanto no celular, abra o mesmo endereço HTTPS do serviço Render nos dois navegadores. Isso não exige instalar o projeto em cada dispositivo. O histórico e as notas continuam separados por navegador; esta versão não sincroniza dados entre os aparelhos.

A publicação no GitHub Pages agora é manual pelo workflow **Publish GitHub Pages → Run workflow**. Enviar alterações para `main` mantém a validação de CI e pode acionar o deploy do serviço Render configurado nessa branch, sem iniciar uma nova publicação automática no Pages.

Uso pessoal é diferente de acesso privado: o endereço atual do Render pode ser acessado por outras pessoas enquanto não houver autenticação/rede privada. A pesquisa não adiciona login nem torna esse endereço privado. O UUID da sessão e o CORS não substituem senha. Para restringir acesso, configure proteção antes de guardar dados sensíveis.

## Validação

`npm test` verifica extração HTML/RSS, bloqueios, fallback, limites, cancelamento, roteamento de comandos, resumo com fontes reais e descarte de links inseguros. Os testes usam respostas controladas dos buscadores/modelo; eles não confirmam disponibilidade dos serviços externos. Os testes Playwright verificam uso no desktop/celular, modo voz, histórico, links e tratamento de falhas.

Para verificar a instalação real, envie `pesquise documentação oficial React`, abra as fontes e confirme que correspondem ao assunto. Depois tente uma pergunta atual e confira a data nas páginas. Um health check ou build bem-sucedido não confirma uma consulta externa real.
