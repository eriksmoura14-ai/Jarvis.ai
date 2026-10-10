# Conversa, tempos e recepção pessoal

Esta atualização usa o backend, o modelo, a memória e o ElevenLabs já configurados.
Não exige conta nova, plano pago, variável nova ou migração do Supabase. Atualize
o site nos dois aparelhos após o deploy. As opções de voz/recepção ficam por
navegador; seu nome e tratamento continuam na conta.

## Usar

1. Faça uma pergunta. Se o backend anunciar suporte, o texto do Groq/Ollama
   aparece à medida que chega. Erros ou interrupções descartam o rascunho;
   somente a resposta final confirmada é salva e falada. Não se fala um fato
   que o servidor já recusou por uma mudança na memória durante a geração.
2. Em **Preferências → Tempos da conversa**, confira as medições da última troca:
   captura/reconhecimento, conexão/autenticação, primeiro texto, resposta inteira,
   preparação, IA/busca/comando, gravação e primeira voz. A voz em partes mostra
   também o último trecho reproduzido, que pode ser diferente do primeiro.
3. **Voz em partes** divide textos maiores em até duas leituras, prepara a segunda
   durante a primeira e mantém 1.200 caracteres no total. Cada parte é uma
   chamada e verifica o plano Free/cota. Uma resposta curta continua usando uma.
   Desative para um único MP3. Repetir usa até dois áudios em RAM; recarregar/sair
   descarta o cache. Uma geração já aceita pode consumir créditos mesmo cancelada.
4. Para experimentar interrupção pela fala, ative **Interromper dizendo “Jarvis,
   pare”**, feche Preferências e inicie pelo microfone. Só aceita o comando de
   parada durante a reprodução; não existe conversa simultânea livre. Use fones
   e mantenha o botão central como alternativa.
5. No modo pessoal, a recepção usa seu tratamento salvo, como “senhor”. **Ouvir
   saudação** exige seu toque. **Resumo de notícias** pesquisa o assunto configurado
   e mostra fontes. Para fazê-lo ao abrir, ative **Buscar notícias ao abrir**;
   para falar o resumo, ative também **Ler o resumo de notícias**.

A consulta automática espera a página ficar visível, nenhuma janela de
Preferências aberta e o assistente livre. O marcador local limita a uma tentativa
por dia por navegador; falhas não geram repetição automática. O botão sob demanda
continua disponível. Limpar dados do navegador remove esse marcador. Computador
e celular têm marcadores próprios e podem consumir duas consultas no mesmo dia.
Tema e texto da busca são enviados ao buscador; trechos podem ser enviados ao
modelo. A pesquisa passa pelas mesmas cotas e entra no histórico pessoal.

## O que os tempos significam

São medições reais da sessão com `performance.now()`, não estimativas fixas.
Não ficam no banco/histórico nem são enviadas para analytics. O total da resposta
inclui conexão, autenticação e o trabalho do servidor; os tempos internos começam
no handler após autenticar/validar. Captura inclui a duração de sua própria fala.
O tempo até o primeiro áudio começa no envio, incluindo espera pela resposta.
Os tempos do último áudio começam naquela leitura e incluem obtenção/cache do
MP3 e início da reprodução. “—” significa que aquela etapa não foi medida.

O Render gratuito pode dormir. Uma conexão demorada sugere investigar rede ou
despertar do serviço, mas não comprova qual deles causou a demora. A aplicação
não faz keep-alive artificial para evitar a suspensão. Compare a primeira
abertura após inatividade com duas perguntas seguintes. Consulte também o
status do provedor se a geração estiver lenta. Não há percentual de melhoria
prometido: os testes locais usam fornecedores simulados, não sua conta real.

## Limitações reais

- Notícias são resultados de busca, não uma assinatura editorial: o resumo usa
  títulos/trechos, não lê as páginas. Confirme datas e fatos nos links. A data
  da consulta não é a publicação. Não existe monitoramento em segundo plano.
- Voz mais humana depende do modelo conversacional e da voz escolhida. Respostas
  curtas e continuidade ajudam, mas não criam compreensão ou lembrança ilimitada.
- Autoplay no celular pode ser bloqueado; use **Ouvir resposta**. Nada desperta
  o navegador fechado nem fala com tela bloqueada. O microfone não liga ao abrir.
- A interrupção usa reconhecimento do navegador, possivelmente externo. Ignora
  fala comum e comandos presentes literalmente na resposta para reduzir eco,
  mas não faz cancelamento acústico robusto. Nenhuma transcrição dessa escuta
  é enviada ao chat/armazenada. Falhas preservam o botão de parada.
- Não há palmas, wake word permanente, notificações push, agenda ou acesso ao OS.
- A build Pages mantém comandos/voz nativa. Não acessa a conta privada do Render.

## Testar

```sh
npm test
npm run build
E2E_PRODUCTION=1 npm run test:e2e
E2E_PRODUCTION=1 npm run test:personal
```

Os testes de servidor verificam streaming Groq/Ollama, Unicode, fim incompleto,
sanitização, limites, cancelamento HTTP real, contexto alterado durante a geração
e busca com fallback para fontes. O navegador verifica rascunho fora do histórico,
erro/cancelamento sem fala atrasada, preparação em duas partes, cache após bloqueio,
parada por comando e recepção/notícias com o marcador diário. Chromium desktop e
celular emulado não substituem dispositivos reais.

No celular e Xbox Edge, confira permissão/reconhecimento, autoplay, fones/eco,
comando de parada, duas partes sem sobreposição, pausa ao trocar aplicativo e
recepção após entrar. No Xbox, teste também foco com direcional/A/B, teclado
virtual e a leitura dos links de notícias. Nenhum desses testes físicos foi
feito no ambiente de desenvolvimento.
