# Conversa com IA e contexto

O JARVIS mantém o motor de comandos e acrescenta conversa livre por um modelo no backend. O modelo recebe a pergunta atual e até 10 mensagens recentes, limitadas a 8.000 caracteres no total e 2.000 por mensagem. Limpar a conversa limpa esse contexto. Sem login pessoal, o contexto vem do navegador e o backend não guarda nem compartilha as mensagens. No [modo pessoal](personal.md), o contexto vem do histórico ativo no servidor e das memórias salvas; acompanha sua conta entre aparelhos, ignorando o contexto enviado pelo cliente. Correções/exclusões de memória reiniciam esse contexto sem apagar o histórico visível.

Comandos como `hora`, `calcular ...`, `anotar ...` e `notas` têm prioridade e continuam locais, exceto quando você ativa explicitamente o modo de pesquisa. Use `pesquise <assunto>` para consultar a web com fontes; veja [como a pesquisa funciona](search.md). O backend fornece trechos reais de busca à IA, sem executar ações solicitadas por ela: pedir “guarde isso” ao modelo não salva uma nota. Use `anotar <texto>`. No GitHub Pages, comandos e notas continuam no navegador mesmo com backend conectado.

## 1. Escolher e configurar o modelo no backend

Node.js 24 e SQLite continuam sendo suficientes para o backend. Copie `.env.example` para `.env` em desenvolvimento. Em hospedagem, use as variáveis de ambiente do serviço. Nunca versione `.env` nem use variáveis `VITE_` para chaves.

### Groq: API de modelo

Crie uma chave no [painel oficial](https://console.groq.com/keys) usando uma conta com cota gratuita, sem ativar cobrança. Confira no painel a elegibilidade da conta, exigência de cartão, cotas e os identificadores dos modelos disponíveis; esta integração não garante que essas condições permanecerão iguais. O modelo `openai/gpt-oss-20b` consta na lista de limites gratuitos consultada durante a integração; confirme sua disponibilidade na conta. Modelos Llama anteriormente sugeridos podem exigir plano Enterprise.

Configure no **backend**:

```dotenv
AI_PROVIDER=groq
# Substitua por um identificador disponível no catálogo da sua conta.
AI_MODEL=identificador-do-modelo
# Preencha este valor somente em .env local ignorado ou no painel seguro do servidor.
GROQ_API_KEY=
AI_DAILY_LIMIT=100
ALLOWED_ORIGINS=https://eriksmoura14-ai.github.io
```

O endpoint é fixo: `https://api.groq.com/openai/v1/chat/completions`. A chave acompanha apenas a chamada do backend para esse endpoint. Ela não é retornada pelo health check, incluída nas respostas nem enviada ao Pages. Redirecionamentos são recusados. Erros do provedor são convertidos em mensagens sem expor o corpo original/credenciais.

### Ollama: modelo no seu computador

Instale o [Ollama](https://ollama.com/) no computador que executará o modelo. Baixe um modelo compatível com a memória e capacidade dessa máquina; um exemplo sem modo de raciocínio separado é `qwen2.5:3b`:

```bash
ollama pull qwen2.5:3b
ollama serve
```

Se o aplicativo Ollama já estiver rodando, não inicie um segundo servidor. Confirme o modelo instalado com `ollama list`. A inferência por CPU pode ser lenta; o JARVIS limita cada resposta Ollama a 15 segundos e até 700 tokens solicitados. Um modelo que exceda esse tempo precisa de hardware mais rápido ou ser menor. Na Groq, os modelos GPT-OSS 20B/120B usam esforço baixo e até 1.024 tokens de conclusão para reservar espaço à resposta após o raciocínio; outros modelos mantêm 700.

```dotenv
AI_PROVIDER=ollama
AI_MODEL=qwen2.5:3b
OLLAMA_URL=http://127.0.0.1:11434
AI_DAILY_LIMIT=100
ALLOWED_ORIGINS=https://eriksmoura14-ai.github.io
```

Não exponha o Ollama diretamente ao navegador: o JARVIS faz a chamada pelo backend. Sem modelo instalado ou com Ollama parado, perguntas livres exibem um erro; notas e cálculos permanecem utilizáveis. `OLLAMA_URL` é definida pelo administrador, sem aceitar um destino enviado no corpo das mensagens.

## 2. Executar e verificar o backend

```bash
npm ci
npm run build
npm start
```

Por padrão ele escuta em `127.0.0.1:3001`. O health check `/api/health` informa `ai.configured`, o provedor e o modelo. **Isso confirma a configuração, não a validade da chave, o modelo instalado ou uma inferência real.** Envie `Explique React em duas frases` para testar o modelo e depois `Resuma isso em uma frase` para testar o contexto. No chat, respostas do modelo recebem o selo `IA`; comandos recebem `LOCAL`.

Sem `AI_PROVIDER`, ou com `AI_PROVIDER=local`, não há chamada ao modelo. Selecionar um provedor sem as variáveis necessárias impede a inicialização, com uma mensagem de configuração; nenhuma chave é colocada automaticamente.

## 3. Usar pelo celular com o site publicado

O GitHub Pages não executa Node.js nem hospeda modelos. É necessário um serviço de backend separado, acessível por **HTTPS**, que execute o projeto com Node.js 24:

- Instalação/build: `npm ci && npm run build`.
- Inicialização: `npm start`.
- `HOST=0.0.0.0`; `PORT` deve seguir a porta fornecida pela hospedagem.
- Defina as variáveis do provedor acima no painel do backend.
- Use `ALLOWED_ORIGINS=https://eriksmoura14-ai.github.io`, sem `/Jarvis.ai/` nem barra final.
- Armazene `DATABASE_PATH` em um volume persistente se quiser preservar notas e o orçamento de IA após reinícios. Hospedagens com disco temporário perdem esses dados.

A escolha/hospedagem desse serviço exige uma conta e depende das condições atuais dos planos gratuitos. Esta versão não contrata serviços nem cadastra cartão. Um computador com Ollama também precisa ficar ligado e ter acesso ao backend; publicar apenas o frontend não permite que outros dispositivos alcancem `localhost` desse computador.

### Configuração no Render

No serviço **Web Service**, use Node.js 24, build `npm ci && npm run build` e start `npm start`. Em **Environment**, defina `HOST=0.0.0.0`, além das variáveis do provedor e de `ALLOWED_ORIGINS` indicadas acima. Deixe o Render fornecer `PORT`.

O projeto também reconhece a variável automática `RENDER=true` e usa `0.0.0.0` quando `HOST` não foi definida. Se houver `HOST=127.0.0.1` no painel ou em um `.env`, altere para `0.0.0.0`: um valor explícito tem prioridade. Não envie o `.env.example` de desenvolvimento como configuração de produção sem ajustar essa variável.

Se o log mostrar `No open ports detected on 0.0.0.0` e o servidor estiver escutando em `127.0.0.1`, corrija `HOST` e use **Save, rebuild, and deploy** ou **Manual Deploy → Deploy latest commit**. A mensagem `.env not found. Continuing without it.` é normal quando as variáveis vêm do painel. Depois que o deploy ficar **Live**, confira `/api/health` e faça uma pergunta para verificar a inferência; um build bem-sucedido sozinho não confirma a IA.

No celular:

1. Abra [o JARVIS](https://eriksmoura14-ai.github.io/Jarvis.ai/).
2. Abra **Preferências → Conversa com IA**.
3. Informe a origem HTTPS do seu backend, por exemplo `https://seu-backend.example` (substitua pelo endereço real), sem caminho ou credenciais.
4. Toque em **Conectar IA**. A conexão só é salva quando o backend informa um modelo configurado.
5. Feche Preferências e faça a primeira pergunta. O aplicativo envia texto e contexto. No Pages, o áudio usa os recursos do navegador; no servidor pessoal, existe também a [opção ElevenLabs](voice.md).

O endereço fica no `localStorage` deste navegador. Para remover a conexão, use **Usar somente comandos locais**. Isso preserva histórico e notas. Se o backend ficar indisponível, comandos locais do Pages continuam funcionando e perguntas livres preservam o texto para tentar novamente.

## Limites e privacidade

- Até duas chamadas de modelo simultâneas e seis tentativas por minuto no servidor inteiro.
- Por padrão, 100 tentativas/dia UTC no servidor inteiro. `AI_DAILY_LIMIT` aceita de 1 a 1.000. Tentativas que falham também contam; comandos locais não contam.
- A contagem diária fica em SQLite e sobrevive a reinícios se o arquivo for preservado. Perder o banco ou executar réplicas com bancos diferentes permite orçamentos separados; os limites do provedor continuam sendo necessários.
- O limite do aplicativo não estabelece o plano/cobrança da conta do provedor. Use apenas uma conta elegível com cota gratuita e sem cobrança ativada nesta etapa.
- A API também limita mensagens por IP. CORS permite somente origens configuradas e a própria origem; **CORS não é autenticação**. Sem `JARVIS_PASSWORD`, um backend público pode receber chamadas de terceiros e consumir a cota. Para uso privado, ative o [modo pessoal com login](personal.md).
- Interromper a conversa cancela a requisição no navegador e propaga o cancelamento ao modelo. O provedor pode já ter processado parte do pedido; a tentativa continua contando.
- Nenhuma inferência real pode ser confirmada sem chave válida/servidor de modelo instalado. Os testes automatizados usam respostas controladas para validar protocolos, contexto, limites e erros.


## Texto progressivo e resposta falada

O frontend negocia a capacidade `streaming` pelo health check. Com `stream=true`
no `POST /api/chat`, recebe NDJSON com eventos `ready`, `text` (texto acumulado
provisório), `result` (resposta final) ou `error` (erro sanitizado após os headers).
Validação/login/cotas da rota continuam ativos. Erros antes de iniciar o stream
usam o status HTTP normal. Clientes antigos sem `stream` continuam recebendo JSON;
o frontend também aceita JSON de backends anteriores.

Groq usa SSE do Chat Completions; Ollama usa NDJSON de `/api/chat`. Só o conteúdo
textual é mostrado, sem deltas de raciocínio. Fim explícito é obrigatório; limite
de bytes/linha, cancelamento, timeout e cotas permanecem. O envio ao navegador é
limitado em frequência e bytes; leitores lentos são cancelados. Comandos locais
não acionam o modelo. A busca conserva fontes reais mesmo se o resumo falhar.

O texto progressivo não entra no histórico nem é falado. No modo pessoal,
`result` só sai após salvar com a geração correta; correções/exclusões durante a
inferência produzem erro e removem o rascunho. O contexto de uma inferência que
já recebeu dados não pode ser retirado do provedor retroativamente.

`voice=true` pede frases curtas e linguagem falada ao modelo; não garante qualidade
humana. [Tempos da conversa](conversation.md) separam espera da resposta e da voz,
sem telemetria externa ou promessas de aceleração medidas apenas com fixtures.
