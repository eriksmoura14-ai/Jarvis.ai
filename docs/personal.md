# JARVIS pessoal: login, memória e sincronização

O modo pessoal tem um único dono, que entra com a mesma senha no celular e no
computador pelo endereço do Render. Não cria cadastro público. Sem
`JARVIS_PASSWORD`, o modo anterior continua disponível e **não é privado**.

## Ativar no Render com Supabase

1. Abra <https://supabase.com/dashboard> e crie um projeto na modalidade **Free**.
   Confira os termos e as cotas exibidos na sua conta; não ative planos pagos.
   Escolha uma senha forte para o banco e guarde-a. Ela não é a senha do JARVIS.
2. No projeto, abra **SQL Editor → New query**, cole o conteúdo de
   [`supabase/personal.sql`](../supabase/personal.sql) e execute **Run**. O script
   cria uma tabela com RLS e bloqueia os papéis públicos `anon` e `authenticated`.
3. Em **Project Settings → API / API Keys** (ou na janela **Connect**), encontre
   a **Project URL** e uma chave **secret** de backend, começando por `sb_secret_`.
   Também é aceita a chave antiga **service_role**. Não use a chave publishable/anon.
   Nunca coloque a chave no chat, GitHub ou frontend.
4. Abra <https://dashboard.render.com/web/srv-db4o3rl9fdbs73a9haa0/env> e adicione,
   como variáveis do serviço:

   | Nome | Valor colocado somente no Render |
   | --- | --- |
   | `JARVIS_PASSWORD` | Uma senha pessoal forte com 12 a 200 caracteres |
   | `SUPABASE_URL` | Project URL, como `https://seu-projeto.supabase.co` |
   | `SUPABASE_SECRET_KEY` | Chave secret de backend ou service_role |

   Preserve `AI_PROVIDER`, `AI_MODEL` e `GROQ_API_KEY`. Clique em **Save, rebuild,
   and deploy**, ou salve e faça um novo deploy. Não crie variáveis `VITE_` para
   senhas ou chaves. O script SQL deve ser executado antes do primeiro login.
5. Depois de **Live**, abra <https://jarvis-ai-dwqp.onrender.com/> no computador e
   no celular. A tela deve pedir sua **senha pessoal do JARVIS**. Entre nos dois.
   Em **Preferências → Memória pessoal**, o armazenamento deve aparecer como
   **Supabase**. Se a tela ainda não pedir senha, a privacidade não está ativada.

Esse passo precisa da sua conta: o agente não tem acesso administrativo aos
painéis Supabase/Render. Os testes locais não confirmam a configuração do seu
projeto. Não há recurso que crie uma conta ou informe uma senha automaticamente.

Se o build passar e o processo encerrar com **variável ausente ou vazia**, o início
da mensagem identifica o nome que falta: `SUPABASE_URL` ou `SUPABASE_SECRET_KEY`.
Confira **Environment do mesmo serviço Render** indicado acima, preencha o valor
e salve com um novo deploy. Cadastrar uma chave no Supabase não a cadastra no
Render. O aviso `.env not found` é normal quando as variáveis vêm do painel.
Não envie valores de senhas/chaves junto dos logs. A validação não ignora uma
conexão incompleta nem troca automaticamente para armazenamento temporário.

## Usar

- Em **Preferências → Memória pessoal**, preencha **Seu nome** e **Como o JARVIS
  deve chamar você?**, por exemplo `senhor`. Clique em **Salvar perfil**. O perfil
  acompanha sua conta nos aparelhos; usa até duas das 30 memórias. Um campo vazio
  remove aquela informação. Não é necessário configurar novas variáveis no Render
  nem executar outro script SQL no Supabase.
- `meu nome é Erik` e `me chame de senhor` são pedidos explícitos de perfil. Um
  novo nome ou tratamento substitui o anterior, incluindo duplicatas antigas
  reconhecidas, sem apagar suas outras memórias. `qual é meu nome` consulta o nome
  salvo sem gastar uma chamada de IA. Saudações como `bom dia` usam o tratamento.
- `esqueça meu nome` remove o nome salvo, preservando a forma de tratamento.
- `lembre que estudo programação à noite` salva uma preferência explícita.
- Para projetos que devem continuar conhecidos além das últimas mensagens, diga
  `lembre que meu projeto atual é um site de estudos de React`. As memórias salvas
  acompanham as perguntas à IA mesmo após recarregar ou mudar de aparelho.
- `minhas memórias` ou `o que você lembra sobre mim` consulta as preferências.
- `corrija memória 1 para estudo de manhã` substitui a informação de número 1.
  `esqueça memória 1` remove somente aquela memória. Consulte a lista atual antes
  de usar números, pois a ordem pode mudar quando outro aparelho fizer alterações.
- `apagar memórias` remove todas as preferências salvas.
- **Preferências → Memória pessoal** permite adicionar, editar e excluir por ID.
  Uma edição é recusada se outro aparelho já mudou seu conteúdo ou o perfil;
  descarte a edição, confira os valores atualizados e tente novamente.
- `anotar <texto>`, `notas` e `apagar notas` passam a usar a mesma conta nos aparelhos.
- **Projetos e tarefas**, na tela inicial, guarda objetivos, etapas, prazos e
  progresso na conta. O modelo pode propor mudanças para revisão, sem salvar
  automaticamente. Veja [uso, confirmação e limites](projects.md). Não há novo
  SQL ou variável para ativar o painel em uma conta pessoal já configurada.
- As últimas 100 mensagens ficam na conta. A interface atualiza ao voltar para a
  aba e a cada 10 segundos enquanto está visível. A IA recebe o contexto recente
  armazenado no servidor, permitindo continuar uma conversa em outro aparelho.
  A janela enviada à IA é de até 10 mensagens e 8.000 caracteres, com até 2.000
  caracteres por mensagem. Não equivale a recordar todo o histórico. A IA não
  recebe seleções limitadas de notas e projetos pertinentes; use `notas` ou
  `meus projetos` para consultar as listas locais.
- **Limpar conversa** remove o histórico da conta, preservando notas, memórias e projetos.
  Respostas que terminarem depois dessa limpeza não restauram o histórico apagado.
- **Sair da conta** revoga a sessão do aparelho. Mudar `JARVIS_PASSWORD` e reiniciar
  o serviço invalida todas as sessões anteriores; os dados da conta são preservados.

Memórias não são extraídas automaticamente de conversas livres. Declarações
completas de nome/tratamento, os comandos acima e o painel são pedidos explícitos.
Preferências salvas podem
ser enviadas ao provedor de IA quando você faz uma pergunta ou pede um resumo de
pesquisa. **Corrigir/apagar uma memória ou alterar o perfil reinicia o contexto
recente enviado à IA**, preservando as outras memórias salvas. As conversas antigas
permanecem visíveis, mas não são reutilizadas como contexto; use **Limpar conversa**
para apagá-las também. Reimportar histórico antigo depois desse reinício não
restaura referências no contexto. Uma resposta em andamento baseada no contexto
anterior é descartada com pedido para reenviar a pergunta. Isso não remove outras
memórias/notas nas quais você tenha salvo a mesma informação, nem impede que você
a conte novamente. Exclusões são feitas
no banco ativo; backups do provedor e dados já enviados a serviços externos seguem
as políticas desses serviços. Não há criptografia adicional de ponta a ponta.

## Recepção e notícias

Ao abrir a conta, uma saudação local usa o horário deste aparelho e o tratamento
salvo (ou nome, se não houver tratamento). Não usa IA nem liga o microfone. O
botão **Ouvir saudação** usa a voz escolhida e pode consumir cota ElevenLabs.

Em Preferências, **Buscar notícias ao abrir** habilita uma pesquisa de até um
assunto configurado, uma vez por dia por navegador, com a página visível e o
assistente livre. **Ler o resumo de notícias** é uma escolha separada. Por
padrão, ambas vêm desligadas; o botão **Resumo de notícias** funciona sob demanda.
Os tópicos dessas buscas não são inferidos das memórias. A consulta e a resposta
entram no histórico da conta; preferências e marcador diário ficam no aparelho.
Uma tentativa falha não fica repetindo automaticamente. Outro aparelho pode
fazer sua própria consulta. [Comportamento e limitações](conversation.md).

## Histórico antigo e funcionamento sem rede

Não há migração automática. **Importar histórico deste navegador** envia, com seu
clique, até 100 mensagens compatíveis e notas da sessão antiga que ainda existirem
no SQLite. Depois da importação, esse histórico antigo é removido do navegador.
Faça isso em cada aparelho cujo histórico deseja trazer. Dados já perdidos por um
deploy do Render não podem ser recuperados pela importação. Notas do modo estático
do GitHub Pages não são importadas por esse fluxo; a origem do navegador é outra.

No modo pessoal, o histórico da conta não é salvo no localStorage. Ele fica na
memória da página durante a sessão; preferências visuais e de voz continuam locais.
Sem servidor ou sem banco, o aplicativo informa o erro e não libera uma sessão
privada por fallback. Os comandos também precisam do servidor autenticado.
O site antigo do GitHub Pages não permite login com cookies deste modo: use o
endereço do Render. Depois de ativar a senha, a API recusa acesso externo do Pages.

## Desenvolvimento local

Copie `.env.example` para `.env` sem sobrescrever configurações existentes. Defina
`JARVIS_PASSWORD` com uma senha sua e deixe as duas variáveis Supabase vazias para
usar SQLite no computador. Depois:

```sh
npm ci
npm run dev
```

Sem `NODE_ENV=production`/`RENDER=true`, o cookie funciona em HTTP local. O modo
HTTP é apenas para desenvolvimento; hospedagem exige HTTPS. No Render, usar
apenas SQLite pode perder dados em deploys. Para sincronizar entre aparelhos,
todos precisam acessar **o mesmo backend**, não instâncias SQLite separadas.

```sh
npm test
npm run build
npm run test:personal
E2E_PRODUCTION=1 npm run test:personal
```

Os E2E usam senha exclusivamente de fixture e SQLite temporário. Desktop e mobile
rodam em processos separados para respeitar o limite real de tentativas de login.
Os testes do adaptador Supabase simulam HTTPS/CAS e falhas; não substituem uma
verificação no projeto real.

## Arquitetura e limites

`PersonalAuth` deriva o verificador com scrypt, compara em tempo constante e usa
tokens aleatórios de 256 bits. Só o hash do token é guardado no banco. Cookies têm
HttpOnly, SameSite=Strict, validade de sete dias e Secure na hospedagem. Logout e
troca de senha invalidam sessões; há até 20 sessões ativas por dono. Login limita
cinco tentativas por IP/minuto e dez no total/minuto, com duas verificações simultâneas.

Todas as rotas de chat e dados pessoais exigem autenticação. Mutações também
exigem o cabeçalho do cliente e rejeitam origens externas, mesmo que antes
permitidas pelo CORS. Health e estado do acesso permanecem públicos, sem dados
pessoais. O backend não usa Supabase Auth: a senha única é verificada no Fastify.

`PersonalStore` mantém até 100 mensagens, 100 notas e 30 memórias de 500 caracteres.
O histórico também tem limite total de 1 MB; as mensagens mais antigas saem primeiro se ele for atingido. Respostas pessoais têm até 6.000 caracteres. O contexto para o modelo é guardado separadamente do histórico visível, com compatibilidade para documentos antigos; não há migração destrutiva ou nova tabela. Listas longas são limitadas no chat, e as notas completas aparecem no painel de memória. O limite diário de IA e as sessões também ficam no armazenamento durável. A
implementação usa um documento JSON para o dono e outro para as sessões, com compare-and-swap por versão
e até seis tentativas para não sobrescrever atualizações concorrentes. A sincronização usa ETag para não baixar novamente um histórico inalterado. Não é
arquitetura para múltiplos usuários. Supabase é acessado exclusivamente no servidor
por HTTPS com a chave secret/service_role; resultados de falhas são sanitizados.

O plano Free pode pausar projetos por inatividade e aplica limites próprios.
O Render gratuito também pode demorar para despertar. Não foram ativados planos
pagos nem garantido funcionamento contínuo. Faça backups pelo seu provedor.

## Testar após ativar

Perguntas pessoais podem usar notas recuperadas além das memórias: até cinco trechos de mil caracteres, selecionados por palavras pertinentes e recência. Teste `O que eu anotei sobre meu projeto Jarvis?`. A seleção é limitada, sem busca por significado nem leitura de todas as notas. O modelo recebe esses dados, mas comandos/perguntas pessoais reconhecidos não viram pesquisas públicas quando a opção web está marcada. Veja [interpretação](interpretation.md). `apagar notas` reinicia o contexto e invalida respostas em andamento com as notas antigas, preservando o histórico visível.

Entre no computador e celular, salve uma preferência e uma nota, abra o outro
aparelho e confira os dados. Recarregue, encerre uma sessão e confirme que ela pede
senha novamente. Faça novo deploy e confirme que memórias e conversas permanecem.
Teste também negar o microfone e usar digitação.

No **Xbox Edge**, ainda precisam de teste físico: teclado virtual da senha,
direcional/A/B no login e nas listas, armazenamento do cookie, redimensionamento,
permissão do microfone, reconhecimento e síntese. Os testes mobile de Chromium
não validam o hardware Xbox nem as vozes reais de cada celular.
