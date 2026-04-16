# Documentação Funcional das Telas

## Objetivo deste documento

Este documento descreve, em nível funcional e de regra de negócio, as telas operacionais atualmente disponíveis no AzureBridge:

- `Dashboard`
- `Sprints`
- `Histórico`

O foco aqui não é a implementação visual, e sim:

- qual é o objetivo de cada bloco/card
- qual endpoint ou conjunto de dados o alimenta
- quais regras de negócio são aplicadas
- quais cálculos são usados para chegar aos números exibidos

---

## Visão geral das fontes de dados

| Área | Fonte principal | Atualização padrão | Observação |
|---|---|---|---|
| Lista de sprints | `GET /sprints` | 30s | Fonte persistida no banco |
| Burndown | `GET /sprints/:id/burndown` | 60s | Baseado em `sprint_snapshots` |
| Modal do dia do burndown | `GET /sprints/:id/scope-changes?date=YYYY-MM-DD` | Sob demanda | Reconcilia itens adicionados, removidos e concluídos do dia |
| Capacidade | `GET /sprints/:sprintId/capacity/comparison` | 60s | Baseado em snapshot persistido da sprint |
| Work items da sprint | `GET /work-items` | 30s | Banco com enriquecimento live do Azure para estado/coluna/datas quando há `sprintId` |
| Impedimentos do Dashboard | `GET /work-items/blocked` | 30s | Mistura banco + leitura live do Azure Taskboard |
| Histórico de sprints | `GET /projects/:id/sprint-history` | 5 min | Baseado em `sprint_history_summary` |

---

## Regras transversais do sistema

### 1. Dias úteis

Quase todos os cálculos analíticos consideram apenas dias úteis.

Regras aplicadas:

- sábados e domingos são ignorados
- feriados não são modelados automaticamente
- `dayOffDates` representa folgas coletivas da sprint
- `dayOffDates` é derivado como a interseção das folgas dos membros, ou seja, só entra ali o dia em que todos estão de folga

Impacta principalmente:

- linha ideal do progresso
- burndown
- quantidade de dias restantes
- Work Item Aging
- CFD

### 2. Tipos de work item considerados

As telas não usam sempre os mesmos tipos.

| Componente | Tipos considerados |
|---|---|
| Burndown / escopo diário | `Task`, `Bug`, `Test Case` |
| Donuts de distribuição | `Task`, `Bug` |
| CFD | conta itens de fluxo, excluindo `PBI/User Story` dos contadores visuais |
| Work Item Aging | apenas `Task` |
| Trabalho não alocado em capacidade | `Task`, `Bug`, `Test Case` |

### 3. Regra de item bloqueado

Um item pode ser classificado como bloqueado por qualquer uma das condições abaixo:

- `isBlocked = true`
- estado igual a `Blocked`, `Impedido` ou `Impeded`
- tag contendo `block` ou `imped`
- para o card de impedimentos do Dashboard, também pode entrar por leitura live da coluna do Taskboard no Azure

### 4. Estado concluído

Estados tratados como concluídos em várias métricas:

- `Done`
- `Closed`
- `Completed`

### 5. Planejado inicial x planejado atual

O sistema diferencia dois conceitos:

- `Planejado inicial`: compromisso/base original antes do efeito líquido do primeiro dia útil
- `Planejado atual/final`: escopo total corrente ou final da sprint

Em telas baseadas em burndown:

- `plannedInitial` prefere `plannedInitialBeforeD1`
- se não existir, usa `firstSnapshot.totalWork - (firstSnapshot.addedCount - firstSnapshot.removedCount)`
- `plannedCurrent` usa o `totalWork` do último snapshot

Em telas baseadas em capacidade:

- `totalPlannedInitial` e `totalPlannedCurrent` vêm do snapshot persistido de capacidade

---

## Tela: Dashboard

Arquivo principal: `Frontend/src/features/dashboard/pages/Dashboard.tsx`

### Objetivo da tela

Exibir a visão operacional da sprint ativa do projeto selecionado, combinando:

- capacidade
- planejamento
- avanço
- impedimentos
- saúde da sprint
- distribuição dos work items
- fluxo acumulado
- burndown

### Regras de seleção da tela

- a tela busca apenas sprints com estado `Active`
- o seletor de projeto mostra apenas projetos que possuem sprint ativa
- se o projeto selecionado não for mais válido, a tela troca automaticamente para o primeiro projeto com sprint ativa
- a sprint usada na tela é a sprint ativa do projeto selecionado

---

### Card: Capacidade Total

**Objetivo**

Mostrar a capacidade disponível total da sprint.

**Fonte**

- `GET /sprints/:sprintId/capacity/comparison`

**Regra de negócio**

- soma a capacidade disponível dos membros da sprint
- usa `availableHours` já persistido por membro
- respeita dias úteis e folgas individuais/equipe no momento em que a capacidade foi sincronizada do Azure

**Cálculo**

- valor exibido = `capacityData.summary.totalAvailable`

---

### Card: Planejamento

**Objetivo**

Mostrar o escopo total planejado da sprint e sua variação em relação ao compromisso inicial.

**Fonte**

- preferencialmente burndown (`/burndown`)
- fallback: snapshot de capacidade (`/capacity/comparison`)

**Regra de negócio**

- quando existe histórico de burndown, a tela passa a usar o snapshot como fonte principal
- o card mostra inicial, final e delta
- o delta reflete ganho/perda líquida de escopo

**Cálculo**

- `plannedInitial = plannedInitialBeforeD1`, se existir
- senão `plannedInitial = firstSnapshot.totalWork - (firstSnapshot.addedCount - firstSnapshot.removedCount)`
- `plannedCurrent = lastSnapshot.totalWork`
- `plannedDelta = plannedCurrent - plannedInitial`

Fallback sem burndown:

- `plannedInitial = capacity.summary.totalPlannedInitial`
- `plannedCurrent = capacity.summary.totalPlannedCurrent`

---

### Card: Restante

**Objetivo**

Exibir quantas horas ainda faltam para concluir a sprint.

**Fonte**

- burndown ou capacidade

**Cálculo**

- com burndown: `remainingHours = lastSnapshot.remainingWork`
- sem burndown: `remainingHours = capacity.summary.totalRemaining`

---

### Card: Concluído

**Objetivo**

Exibir quanto da sprint já foi entregue em horas.

**Fonte**

- burndown ou capacidade

**Cálculo**

- com burndown: `completedHours = lastSnapshot.completedWork`
- sem burndown: `completedHours = plannedCurrent - remainingHours`

**Regra de negócio**

- quando existe snapshot, ele é a fonte principal
- o número é acumulado na sprint, não apenas no dia

---

### Card: Impedimentos

**Objetivo**

Mostrar quantos itens estão bloqueados na sprint ativa e permitir abrir o detalhamento.

**Fonte**

- `GET /work-items/blocked`

**Regras de negócio**

- no Dashboard, este card usa uma rota específica de impedimentos
- essa rota pode identificar bloqueios tanto pelo banco quanto pelo Azure Taskboard
- os itens são ordenados por ID decrescente
- o modal mostra:
  - ID
  - título
  - tipo
  - responsável
  - link para o Azure DevOps

**Cálculo**

- total exibido = quantidade de itens retornados por `/work-items/blocked`

---

### Bloco: Progresso da Sprint (Baseado em Horas)

**Objetivo**

Comparar o progresso real da sprint com a trajetória ideal para o dia atual.

**Fonte**

- burndown
- capacidade para `dayOffDates`

**Principais métricas**

- percentual concluído
- ideal acumulado até hoje
- desvio em horas versus ideal
- status: `Adiantado`, `No Prazo`, `Em Risco`, `Atrasado`

**Cálculos**

- `progressPct = completedHours / plannedCurrent`
- `idealRemainingToday` é calculado sobre a série de dias úteis
- `idealCompletedToday = plannedCurrent - idealRemainingToday`
- `deviationHours = remainingHours - idealRemainingToday`
- `deviationPct = deviationHours / plannedCurrent`

**Como a linha ideal é calculada**

1. monta os dias úteis entre início e fim da sprint
2. define a base inicial
3. mantém a linha estável até D1
4. aplica o efeito líquido de escopo do D1
5. para cada dia seguinte:
   - incorpora aumento de escopo quando o `totalWork` sobe
   - redistribui a queima ideal pelos dias úteis restantes

**Thresholds de status**

- `deviationPct <= -5%` → `Adiantado`
- `-5% < deviationPct <= 5%` → `No Prazo`
- `5% < deviationPct <= 15%` → `Em Risco`
- `deviationPct > 15%` → `Atrasado`

---

### Card: Sprint Health Score

**Objetivo**

Gerar uma nota sintética da saúde da sprint.

**Fonte**

- sprint selecionada
- capacidade
- burndown

**Pontuação base**

- começa em `100`

**Regras de penalidade**

1. Utilização de capacidade

- `< 60%` → `-15`
- `> 90%` e `<= 100%` → `-10`
- `> 100%` → `-20`

2. Progresso versus tempo

- calcula:
  - `daysTotal`
  - `daysPassed`
  - `progressRatio = daysPassed / daysTotal`
  - `completionRatio = completedHours / plannedHours`
  - `deviation = abs(completionRatio - progressRatio)`

- penalidades:
  - `deviation > 0.3` → `-30`
  - `deviation > 0.2` → `-20`
  - `deviation > 0.1` → `-10`

3. Blockers

- usa o `blockedCount` do último snapshot
- penalidade = `min(20, blockedCount * 5)`

4. Tracking

- se `sprint.isOnTrack` for falso → `-10`

**Classificação visual**

- `>= 80` → `Excelente`
- `>= 60` → `Bom`
- `>= 40` → `Atenção`
- `< 40` → `Crítico`

---

### Card: Work Item Aging

**Objetivo**

Identificar tasks em andamento que já consumiram mais tempo útil do que o esperado para serem concluídas.

**Fonte**

- `GET /work-items`
- `GET /sprints/:sprintId/capacity/comparison`

**Filtro funcional**

Entram no cálculo apenas itens:

- do tipo `Task`
- em estado `In Progress` ou equivalente
- não bloqueados

**Como a tela determina o esforço esperado**

Para cada item:

- `baseline = max(initialRemainingWork, originalEstimate)`
- `dynamic = max(completedWork + remainingWork, lastRemainingWork, 0)`
- `effortHours = max(baseline, dynamic)`
- se tudo der `0`, usa `1h` como mínimo técnico

**Como a tela determina a capacidade diária**

- se o item tem responsável e existe capacidade individual, usa a capacidade diária desse membro
- senão usa a média diária da equipe

**Como o atraso é calculado**

- `actualHours` = horas úteis desde `activatedDate` até agora
- `expectedHours = effortHours / (capacityPerDay / 8)`
- `ratio = actualHours / expectedHours`

**Status**

- coluna de board de review → `review`
- `ratio > 1.2` → `critical`
- `ratio > 1.0` → `warning`
- caso contrário → `ok`

**Observações importantes**

- considera janela útil de trabalho:
  - início `08:00`
  - fim `17:00`
  - remove almoço `12:00–13:00`
- o modal mostra detalhamento, previsão e exportação em PDF

---

### Gráfico: Work Items por Estado

**Objetivo**

Mostrar a distribuição de `Task` e `Bug` por estado.

**Regra de negócio**

- só conta `Task` e `Bug`
- agrupa pelo campo `state`
- não faz normalização adicional de estados

**Cálculo**

- total por fatia = quantidade de itens daquele estado

---

### Gráfico: Work Items por Tipo

**Objetivo**

Mostrar a composição da sprint por tipo de item operacional.

**Regra de negócio**

- só conta `Task` e `Bug`

**Cálculo**

- total por fatia = quantidade por tipo

---

### Gráfico: Work Items por Membro

**Objetivo**

Mostrar a distribuição de `Task` e `Bug` por responsável.

**Regra de negócio**

- só conta `Task` e `Bug`
- itens sem responsável entram como `Não Alocados`
- o rótulo da legenda tenta reduzir o nome para primeiro nome
- se houver homônimos, usa `PrimeiroNome Sobrenome`

**Cálculo**

- total por fatia = quantidade de itens atribuídos ao membro

---

### Bloco: Capacidade vs Planejado

**Objetivo**

Confrontar a capacidade total da sprint com o trabalho planejado e destacar trabalho não alocado.

**Fonte**

- `GET /sprints/:sprintId/capacity/comparison`

**Indicadores principais**

- `Total Disponível`
- `Total Planejado`
- `Balanço`
- `Utilização`
- `Trabalho Não Alocado`

**Cálculos**

- `displayedPlanned = plannedCurrent`, quando a tela já possui burndown consolidado
- caso contrário usa `capacity.summary.totalPlanned`
- `displayedBalance = totalAvailable - displayedPlanned`
- `displayedUtilization = displayedPlanned / totalAvailable`

**Regra de trabalho não alocado**

São considerados apenas itens sem `assignedToId` e dos tipos:

- `Task`
- `Bug`
- `Test Case`

Os itens são separados em:

- `open`
- `done`

Para cada item, o serviço calcula:

- `plannedInitial`
- `plannedFinal`
- `completedForItem`
- `addedScope`

O card usa principalmente `plannedFinal`.

**Modal de não alocados**

Mostra apenas `Task` do bucket selecionado, com:

- estado
- horas planejadas
- horas restantes
- link Azure

---

### Bloco: Capacidade por Pessoa

**Objetivo**

Comparar capacidade disponível por pessoa versus horas concluídas.

**Fonte**

- `GET /sprints/:sprintId/capacity/comparison`

**Cálculos por membro**

- `capacity = availableHours`
- `completed = completedHours`
- `completionPct = completed / capacity`
- `remainingToCapacity = max(0, capacity - completed)`
- `overCapacity = max(0, completed - capacity)`

**Regra visual**

Barra horizontal empilhada em 3 partes:

- concluído dentro da capacidade
- restante até a capacidade
- excedente acima da capacidade

**Resumo do card**

- `teamPct = totalCompleted / totalCapacity`

---

### Gráfico: Fluxo Acumulado da Sprint (CFD)

**Objetivo**

Mostrar como a massa de trabalho se distribui entre `A Fazer`, `Em Progresso`, `Bloqueado` e `Concluído` ao longo da sprint.

**Fonte**

- snapshots do burndown

**Regras de negócio**

- usa os contadores do snapshot:
  - `todoCount`
  - `inProgressCount`
  - `doneCount`
  - `blockedCount`
- `blocked` é tratado como subconjunto de `inProgress`
- o gráfico só vai até o dia atual
- se não houver snapshot exato para o dia útil, usa o último snapshot anterior

**Cálculo**

- `blocked = min(blockedCount, inProgressCount)`
- `inProgress = inProgressCount - blocked`
- `total = done + blocked + inProgress + todo`

---

### Gráfico: Burndown

**Objetivo**

Exibir a evolução da sprint em horas planejadas, restantes, projeção, alterações de escopo e concluído por dia.

**Fonte**

- `GET /sprints/:id/burndown`
- `GET /sprints/:id/scope-changes?date=...`

**Séries usadas**

- `Ideal`
- `Remaining`
- `Projeção`
- `Escopo Adicionado`
- `Escopo Removido`
- `Concluído no dia`

**Regras de negócio**

- adiciona um ponto `Planning` antes do D1
- usa apenas dias úteis da sprint
- se um dia não tiver snapshot exato, herda o último snapshot anterior
- `completedInDay` é preferido diretamente do snapshot
- se não existir `completedInDay`, faz fallback pelo delta de `completedWork`
- o modal diário usa o mesmo dia canônico do snapshot
- itens concluídos após o fim da sprint aparecem consolidados no último dia útil quando aplicável

**Cálculos principais do cabeçalho**

- `headerInitial = plannedInitial`
- `headerFinal = totalWork` do último snapshot válido
- `headerDelta = headerFinal - headerInitial`
- `remNow = remainingWork` do último ponto real
- `burnedTotal = completedWork` acumulado
- `avgBurn = burnedTotal / workedDays`
- `neededIdealVelocity = totalHours / daysTotal`
- `completionPct = burnedTotal / totalHours`

**Status do burndown**

É derivado do desvio percentual entre o real e o ideal no dia atual/projetado.

**Modal "Detalhes do Dia"**

Mostra três listas:

- adicionados
- removidos
- concluídos

Cada item informa:

- ID
- título
- tipo
- horas alteradas
- autor da mudança
- motivo (`added_to_sprint`, `removed_from_sprint`, `hours_increased`, `hours_decreased`, `completed`)

---

## Tela: Sprints

Arquivo principal: `Frontend/src/features/dashboard/pages/Sprints.tsx`

### Objetivo da tela

Exibir a mesma estrutura analítica do Dashboard, mas aplicada a uma sprint passada selecionada manualmente.

### Regras de seleção

- a tela trabalha com `state = Past`
- os projetos permitidos hoje são:
  - `GIGA - Retrabalho`
  - `GIGA - Tempos e Movimentos`
  - `Projeto Plataforma de Melhorias na Engenharia`
- para `GIGA - Tempos e Movimentos`, só entram sprints cujo nome contém `AV-NAV`
- se o projeto/sprint selecionados não forem válidos, a tela reajusta automaticamente a seleção

### Diferença funcional em relação ao Dashboard

Os cards e gráficos são praticamente os mesmos do Dashboard, mas o contexto muda:

- Dashboard = sprint ativa do projeto
- Sprints = sprint passada escolhida explicitamente

### Observações específicas da tela

- o card de impedimentos aqui não usa a query dedicada de bloqueados; ele deriva os bloqueados a partir da lista de work items carregada para a sprint
- como é uma visão histórica, o principal valor é auditoria/comparação da sprint encerrada, não monitoramento operacional em tempo real

### Cards e cálculos

Todos os blocos abaixo seguem a mesma regra funcional já descrita no `Dashboard`:

- `Capacidade Total`
- `Planejamento`
- `Restante`
- `Concluído`
- `Impedimentos`
- `Progresso da Sprint`
- `Sprint Health Score`
- `Work Item Aging`
- `Work Items por Estado`
- `Work Items por Tipo`
- `Work Items por Membro`
- `Capacidade vs Planejado`
- `Capacidade por Pessoa`
- `Fluxo Acumulado`
- `Burndown`

O que muda é apenas:

- a sprint é passada
- a seleção é manual
- o filtro de projetos é restrito
- no projeto de Tempos e Movimentos, a tela é explicitamente recortada para `AV-NAV`

---

## Tela: Histórico

Arquivo principal: `Frontend/src/features/dashboard/pages/SprintHistory.tsx`

### Objetivo da tela

Comparar sprints do mesmo projeto ao longo do tempo, focando em:

- capacidade
- planejamento
- entrega
- previsibilidade
- volatilidade
- variação de escopo

### Regras de seleção

- mesma lista restrita de projetos da tela `Sprints`
- para `GIGA - Tempos e Movimentos`, só entram sprints com `AV-NAV` no nome
- o endpoint traz sprints `Past` e `Active`, mas os gráficos analíticos excluem a sprint atual

### Fonte principal

- `GET /projects/:id/sprint-history`

Essa rota usa `SprintHistoryService`, que consolida cada sprint em um resumo persistido.

### Como o resumo histórico é calculado

Para cada sprint:

- `capacity` = `teamCapacityHours` ou soma de `availableHours` dos membros
- `planned` = `latestSnapshot.totalWork`
- `remaining` = `latestSnapshot.remainingWork`
- `delivered` = `latestSnapshot.completedWork` ou `planned - remaining`
- `scopeAdded` = soma de `addedCount`
- `scopeRemoved` = soma de `removedCount`
- `finalDeviation = planned - delivered`
- `planVsCapacityPct = planned / capacity`
- `deliveredVsPlannedPct = delivered / planned`
- `deliveredVsCapacityPct = delivered / capacity`

---

### Card: Capacidade média

**Objetivo**

Exibir a média de capacidade das sprints históricas consideradas nos gráficos.

**Regra**

- usa apenas sprints não atuais (`!isCurrent`)

**Cálculo**

- média simples de `capacityHours`

---

### Card: Planejado médio

**Objetivo**

Mostrar o volume médio planejado nas sprints históricas.

**Cálculo**

- média simples de `plannedHours`

---

### Card: Entregue médio

**Objetivo**

Mostrar a média de horas entregues nas sprints históricas.

**Cálculo**

- média simples de `deliveredHours`

---

### Card: Previsibilidade média

**Objetivo**

Mostrar, em média, quanto do planejado foi efetivamente entregue.

**Cálculo**

- média simples de `deliveredVsPlannedPct`

---

### Tabela: Histórico de performance por sprint

**Objetivo**

Apresentar o consolidado principal de cada sprint em formato tabular.

**Colunas**

- Sprint
- Início
- Fim
- Capacidade
- Planejado
- Entregue
- Plan x Cap
- Ent x Plan
- Ent x Cap

**Regras**

- inclui sprint atual, se existir
- destaca a sprint atual com marca visual azul
- usa badges por faixa percentual

**Faixas de badge**

Para `Plan x Cap` e `Ent x Cap`:

- `>= 85%` → verde
- `>= 60% e < 85%` → amarelo
- `< 60%` → vermelho

Para `Ent x Plan`:

- `>= 90%` → verde
- `>= 70% e < 90%` → amarelo
- `< 70%` → vermelho

---

### Gráfico: Capacidade x Planejado x Entregue e indicadores percentuais

**Objetivo**

Comparar volume de horas por sprint e a relação entre planejamento/capacidade e entrega/planejamento.

**Séries**

- barras:
  - `capacity`
  - `planned`
  - `delivered`
- linhas:
  - `planVsCapacity`
  - `deliveredVsPlanned`

**Regra**

- só usa sprints não atuais

---

### Gráfico: Planejamento x Capacidade com Faixas de Saúde

**Objetivo**

Mostrar quão agressivo foi o planejamento frente à capacidade disponível.

**Série**

- `planVsCapacity`

**Faixas**

- `0–60%` → zona crítica
- `60–85%` → zona de atenção
- `85–130%` → zona saudável/uso forte

**Leitura funcional**

- abaixo de 60% sugere subplanejamento
- entre 60% e 85% sugere planejamento conservador
- acima de 85% indica maior comprometimento da capacidade

---

### Gráfico: Tendência de Previsibilidade

**Objetivo**

Acompanhar a evolução do percentual entregue sobre o planejado.

**Série**

- `deliveredVsPlanned`

**Referências**

- linha em `90%`
- linha em `70%`

**Leitura funcional**

- acima de 90% = alta previsibilidade
- entre 70% e 90% = previsibilidade moderada
- abaixo de 70% = baixa previsibilidade

---

### Gráfico: Escopo Adicionado x Removido e Saldo

**Objetivo**

Mostrar a volatilidade de escopo por sprint.

**Séries**

- barra positiva de escopo adicionado
- barra negativa visual de escopo removido
- linha de saldo (`scopeNet`)

**Cálculos**

- `scopeAdded = scopeAddedHours`
- `scopeRemovedVisual = -scopeRemovedHours`
- `scopeNet = scopeAddedHours - scopeRemovedHours`

---

### Gráfico: Eficiência da Sprint

**Objetivo**

Cruzar agressividade de planejamento com capacidade de entrega.

**Eixos**

- X = `planVsCapacity`
- Y = `deliveredVsPlanned`
- tamanho do ponto = `planned`

**Regra de cor**

- verde: `planVsCapacity >= 85` e `deliveredVsPlanned >= 90`
- amarelo: `planVsCapacity >= 60` e `deliveredVsPlanned >= 70`
- vermelho: demais casos

---

### Gráfico: Desvio Final por Sprint

**Objetivo**

Mostrar quanto cada sprint terminou acima ou abaixo do que foi entregue.

**Cálculo**

- `finalDeviation = planned - delivered`

**Interpretação**

- positivo = sobrou trabalho planejado não entregue
- negativo = entregou acima do planejado
- zero = aderência exata

**Regra visual**

- desvio positivo → vermelho
- desvio negativo → verde
- zero → cinza

---

### Gráfico: Volatilidade de Entrega (Control Chart)

**Objetivo**

Avaliar estabilidade da entrega entre sprints.

**Séries**

- `delivered`
- média
- limite superior = média + 1 desvio padrão
- limite inferior = média - 1 desvio padrão

**Cálculos**

- `deliveryMean = mean(deliveredValues)`
- `deliveryStd = stdDev(deliveredValues)`
- `deliveryUpper = deliveryMean + deliveryStd`
- `deliveryLower = max(0, deliveryMean - deliveryStd)`

**Leitura funcional**

- sprints fora da faixa indicam comportamento mais volátil do que o histórico recente

---

## Diferenças funcionais entre as três telas

| Tela | Foco | Contexto de sprint | Observações |
|---|---|---|---|
| Dashboard | Operação atual | Sprint ativa | Usa card de impedimentos com fonte híbrida |
| Sprints | Auditoria detalhada de uma sprint | Sprint passada selecionável | Estrutura quase idêntica ao Dashboard |
| Histórico | Comparação longitudinal | Várias sprints do projeto | Consolida métricas resumidas e comparativas |

---

## Resumo dos principais riscos de interpretação

### 1. Nem todos os componentes contam os mesmos tipos

Exemplo:

- burndown aceita `Task`, `Bug`, `Test Case`
- donuts usam apenas `Task` e `Bug`
- aging usa apenas `Task`

### 2. Impedimentos não são iguais em todas as telas

- no Dashboard, há leitura dedicada para bloqueados
- na tela Sprints, o bloqueio é derivado da lista local de work items

### 3. Histórico e operação não têm o mesmo objetivo

- Dashboard e Sprints são analíticos/operacionais por sprint
- Histórico é comparativo e consolidado

### 4. A sprint atual entra na tabela do histórico, mas não nos gráficos comparativos

Isso é intencional para evitar distorcer médias e tendências com sprint ainda aberta.

---

## Conclusão

Hoje o sistema possui três visões complementares:

- `Dashboard`: monitoramento da sprint ativa
- `Sprints`: análise detalhada de uma sprint passada
- `Histórico`: comparação entre sprints do mesmo projeto

Apesar de compartilharem componentes visuais, cada tela aplica recortes e regras próprios de seleção, atualização e consolidação de dados. Por isso, ao evoluir o produto, qualquer mudança em:

- definição de bloqueio
- tipos considerados
- cálculo de escopo
- snapshot de capacidade
- resumo histórico

deve ser avaliada em todas as três telas para evitar divergência funcional.
