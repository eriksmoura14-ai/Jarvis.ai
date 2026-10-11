# Projetos e tarefas pessoais

Abra o JARVIS no Render, entre na conta e toque em **Projetos e tarefas**, no
quadro de prioridades. Crie um projeto, descreva o objetivo e escreva uma etapa
por linha. O painel funciona sem chamar um modelo de IA.

Você pode adicionar tarefas com prazo opcional, concluir/reabrir tarefas e
arquivar/restaurar projetos. Arquivar preserva os dados e retira as tarefas das
prioridades. A tela inicial mostra as três próximas tarefas; o painel mostra
todas. Prazos vencidos vêm primeiro, seguidos dos demais prazos e das tarefas
sem data. A data atual usa o fuso do aparelho; prazos são datas, sem horário.

## Pedidos no chat ou por voz

Com o modelo compatível já configurado, tente:

- `Crie um projeto para estudar inglês durante três meses, com etapas semanais.`
- `Adicione uma tarefa para praticar conversação no meu projeto de inglês.`
- `Concluí a tarefa Estudar vocabulário do meu projeto de inglês.`

O modelo pode usar `propose_project_change` para apresentar uma **proposta para
revisar**. Confira objetivo, tarefas e datas. Somente **Confirmar proposta**
salva a mudança. **Descartar proposta** não altera seus projetos. Falar o pedido
também exige confirmação na tela; dizer “sim” não executa a proposta.

O JARVIS pode pedir esclarecimento se faltar identificação do projeto/tarefa.
O servidor recusa IDs inventados, campos adicionais e datas inválidas. A IA
não recebe ferramenta para apagar projetos, arquivar ou reabrir tarefas; estas
duas últimas ações estão no painel. Não há edição de títulos ou exclusão de
projetos nesta versão.

Sem modelo, `meus projetos`, `minhas tarefas` e `o que tenho para fazer hoje`
consultam os dados reais da conta sem cota de IA e sem consultar a web.
A consulta lista até dez pendências, incluindo próximas tarefas e
tarefas sem prazo, com seus rótulos.

## Sincronização e confirmação

Projetos e tarefas usam o documento privado existente em SQLite/Supabase. Não
precisa executar outro SQL, criar outra conta ou configurar novas variáveis.
No Render, mantenha Supabase para preservar os dados entre deploys. Todos os
aparelhos devem acessar o mesmo endereço e entrar com sua senha pessoal.
O frontend sincroniza ao voltar para a aba e a cada dez segundos visível.

Cada alteração verifica a revisão dos projetos: uma edição antiga não
sobrescreve mudanças de outro aparelho. Confira o painel atualizado e tente de
novo quando houver conflito. Propostas são assinadas pelo backend, duram dez
minutos e só valem para a revisão e o contexto usados ao prepará-las. Após
alterações de projetos/memórias/contexto ou reinício do servidor, peça uma nova
proposta. Repetir uma confirmação válida já recebida não duplica a mudança.
Há até cinquenta recibos recentes de confirmação.

A proposta não confirmada fica somente na página, sem localStorage ou
persistência no histórico. Recarregar, enviar outro pedido ou limpar a conversa
descarta sua revisão. O texto da resposta permanece no histórico, mas não é um
registro de que a proposta foi aplicada; consulte o painel para conferir.

Alterar um projeto reinicia o contexto ativo da IA e invalida respostas antigas
em andamento, preservando histórico visível, memórias e notas. Isso evita
reutilizar um estado anterior das tarefas ao responder.

## Planejar o dia

Diga “planeje meu dia”, “o que devo fazer hoje?” ou toque em **Planejar meu dia**. Não exige cota de IA: sugere até três passos, priorizando tarefas com prazos reais no fuso do aparelho. Depois vêm tarefas salvas, checklists de ações e tabelas de metas pessoais do Obsidian, com referências. Pendências como preencher perguntas de contexto ou atualizar a etapa real de um projeto ficam depois das ações e metas se não tiverem prazo explícito; continuam guardadas e podem aparecer quando faltam outros passos. Metas viram sugestões para definir um próximo passo, sem afirmar realização ou criar prazos. A seleção usa regras e não infere urgência só porque uma meta aparece primeiro numa nota.

Passos ainda não registrados aparecem numa proposta para o projeto **Plano diário**. Só a confirmação os salva. O projeto é reutilizado; tarefas já registradas, concluídas ou arquivadas não são duplicadas. Limites de projetos/tarefas continuam valendo. Alterar a fonte invalida a proposta antiga. Não modifica os arquivos do Obsidian. Conclua as tarefas no painel quando realmente terminar; o JARVIS não presume conclusão.

## Dados e limites

Até vinte projetos e duzentas tarefas por conta, incluindo projetos arquivados
e tarefas concluídas; até vinte tarefas em cada criação/proposta. O modelo
recebe uma seleção de até cinco projetos ativos e quarenta tarefas ao todo,
ordenada por palavras do pedido e atualização. Descrições são reduzidas a
trezentos caracteres. Não é recuperação por significado nem leitura de todos
os projetos. Nomeie o projeto e a tarefa ao pedir uma mudança.

Esses dados podem ser enviados ao provedor de IA configurado. O filtro de
pesquisas públicas inclui os termos privados dos projetos; não os adiciona
automaticamente ao assunto permitido da pesquisa. Não coloque credenciais em
projetos. Autenticação, cookie HttpOnly, proteção de origem e limites das rotas
continuam ativos. Projetos só estão disponíveis no modo pessoal do servidor,
sem fallback para o GitHub Pages.

Prazos não geram notificações, alarmes ou ações em segundo plano. A ordenação é
por prazo/criação, sem sugestão automática de importância. Não há tarefas
recorrentes, calendário, integrações externas ou exportação nesta etapa.

## Verificar

```sh
npm test
npm run build
E2E_PRODUCTION=1 npm run test:projects
```

Vitest verifica propostas Groq/Ollama, assinatura, adulteração, expiração,
confirmação repetida, contexto alterado, persistência SQLite e adaptador
Supabase com transporte controlado. Playwright verifica o painel real,
sincronização entre duas sessões, revisão antiga, descarte e nova tentativa
após erro, em Chromium desktop/celular. Os modelos são simulados: confirme os
planos reais na sua conta, sem aceitar datas ou etapas que você não deseja.

No celular físico, teste teclado, campo de data, rolagem, retorno à aba e voz.
No Xbox Edge, teste direcional/A/B, foco e rolagem do painel, teclado virtual e
confirmação da proposta. Esses testes de hardware continuam manuais.
