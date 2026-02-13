# AzureBridge — Manual do Usuário

Este documento explica como usar o dashboard do AzureBridge e o significado de cada indicador, gráfico e informação exibida.

---

## Verificação de conexão

Ao abrir o AzureBridge, o sistema verifica automaticamente a conexão com o servidor backend. Durante essa verificação:

- A tela exibe "Conectando ao Servidor..." com uma barra de progresso animada
- O frontend faz polling a cada 2 segundos no endpoint `/api/health`
- Se o servidor responder com sucesso, o dashboard é exibido normalmente
- Se após ~2 minutos o servidor não responder, uma tela de erro aparece com o botão "Tentar Novamente"

> Essa verificação é útil quando os serviços em nuvem (Supabase, containers) estão inicializando.

---

## Navegação básica

### Seletor de projeto

No canto superior direito do dashboard há um seletor de projeto. O sistema lista todos os projetos Azure DevOps sincronizados.

Ao selecionar um projeto, o dashboard exibe automaticamente os dados da sprint ativa daquele projeto.

Se não houver sprint ativa, o dashboard exibe a mensagem:
> "Nenhuma sprint ativa encontrada no momento."

---

## Cabeçalho da Sprint

No topo do conteúdo, são exibidos:
- **Nome da sprint** — ex: `Sprint 45`
- **Período** — datas de início e fim no formato `dd/mm/aaaa - dd/mm/aaaa`

---

## Cards de Métricas (topo)

Cinco cards exibem os indicadores principais da sprint ativa:

### Capacidade Total

Total de horas disponíveis do time na sprint, já descontando dias off (férias, feriados, folgas) configurados no Azure DevOps.

> Exemplo: Se o time tem 5 membros com 8h/dia e 10 dias úteis de sprint = 400h teóricas. Se um membro tem 2 dias de folga (−16h), a capacidade total fica 384h.

---

### Planejamento

Horas totais planejadas nos work items da sprint. Exibe três valores:
- **Inicial** — total de `originalEstimate` dos work items no início da sprint
- **Final** — total atual (pode ter aumentado com scope creep)
- **Delta** — diferença entre final e inicial (`+Xh` se houve adição de escopo)

> Se Delta for positivo (vermelho), significa que o escopo cresceu após o início da sprint.

---

### Restante

Total de horas de `remainingWork` em todos os work items ativos da sprint no momento. Representa o trabalho que ainda precisa ser feito.

---

### Concluído

Calculado como: `Planejado atual − Restante`. Representa as horas de trabalho que já foram registradas como concluídas.

> Atenção: esse valor depende do preenchimento de `completedWork` nos work items do Azure DevOps.

---

### Impedimentos

Quantidade de work items com flag `isBlocked = true` no momento. Um item é considerado bloqueado quando seu estado no Azure DevOps é alterado para "Impedido" ou a tag de bloqueio é ativada.

---

## Barra de Progresso da Sprint

Exibida abaixo dos cards, a barra mostra o percentual de conclusão da sprint com base em horas.

**Cálculo:**
```
% concluído = (Planejado atual − Restante) / Planejado atual × 100
```

**Cores:**
- **Azul** — progresso normal
- **Vermelho** — o trabalho restante é maior do que o total planejado (scope creep severo)

**Alerta de scope creep:** Se `Restante > Planejado`, uma mensagem de aviso aparece:
> "Atenção: O escopo aumentou Xh além do planejado."

---

## Sprint Health Score

Painel que exibe um score de 0 a 100 representando a saúde geral da sprint. Quanto maior, melhor.

### Como é calculado

O score começa em 100 e penalidades são subtraídas conforme os problemas detectados:

| Situação | Penalidade |
|---|---|
| Capacidade utilizada < 60% (time ocioso) | −15 |
| Capacidade utilizada > 90% (alta pressão) | −10 |
| Capacidade utilizada > 100% (sobrecarga) | −20 |
| Desvio progresso vs tempo > 10% | −10 |
| Desvio progresso vs tempo > 20% | −20 |
| Desvio progresso vs tempo > 30% | −30 |
| Cada blocker (máx. 4 blockers) | −5 por blocker |
| Sprint fora do tracking (`isOnTrack = false`) | −10 |

**Desvio de progresso** é a diferença entre:
- % do tempo da sprint decorrido (baseado em data)
- % de horas concluídas (baseado em trabalho)

> Exemplo: 60% do tempo passou, mas apenas 30% do trabalho foi concluído → desvio de 0.30 → penalidade de −30.

### Classificações

| Score | Classificação | Cor |
|---|---|---|
| 80 – 100 | Excelente | Verde |
| 60 – 79 | Bom | Azul |
| 40 – 59 | Atenção | Âmbar |
| 0 – 39 | Crítico | Vermelho |

### Seção "Por que essa nota?"

Abaixo do score, cada penalidade aplicada é listada com sua descrição. Se não houve penalidades: "Sem penalidades."

---

## Blockers Ativos

Painel que lista os work items com `isBlocked = true`.

**Quando não há blockers:** exibe uma mensagem de celebração.

**Quando há blockers:**
- Fundo âmbar de alerta
- Cada item mostra: ID do work item (`#1234`), tipo (`Task`, `Bug`, etc.), título e há quanto tempo está bloqueado

**O que fazer:** acesse o Azure DevOps no link do work item para identificar e resolver o impedimento. O sistema atualiza o status automaticamente no próximo sync (geralmente a cada 1 hora).

---

## Capacidade vs Planejado

Tabela que compara a capacidade disponível do time com o trabalho planejado.

### Resumo no topo

| Campo | Significado |
|---|---|
| Total Disponível | Soma das `availableHours` de todos os membros |
| Total Planejado | Soma das horas planejadas nos work items |
| Balanço | `Disponível − Planejado` |

- **Balanço verde (+)** — o time tem mais capacidade do que trabalho planejado (folga de capacidade)
- **Balanço vermelho (−)** — o time está planejando mais trabalho do que tem capacidade

### Alerta de trabalho não alocado

Se houver work items da sprint sem responsável (`assignedTo` vazio), um alerta âmbar aparece mostrando:
- Quantidade de itens sem alocação
- Total de horas nesses itens

> Itens sem responsável não entram no cálculo de capacidade por membro, podendo distorcer o balanço.

---

## Capacidade por Pessoa

Gráfico de barras horizontais empilhadas que mostra o progresso individual de cada membro do time na sprint.

### Cabeçalho

No topo, exibe os totais do time:
- **Xh de Yh · Z%** — horas concluídas, capacidade total e percentual geral

### Legenda

Três indicadores de cores:

| Cor | Significado |
|---|---|
| Azul | Horas concluídas (dentro da capacidade) |
| Cinza | Horas restantes para atingir a capacidade |
| Âmbar | Horas excedentes (acima da capacidade) |

### Barras

Cada membro tem uma barra horizontal empilhada com até três segmentos:
- **Azul** — trabalho concluído até o limite da capacidade disponível
- **Cinza** — espaço restante até a capacidade
- **Âmbar** — horas que ultrapassaram a capacidade (sobrecarga)

### Tooltip

Ao passar o mouse sobre uma barra, o tooltip exibe:
- Capacidade disponível do membro
- Horas concluídas
- Horas restantes
- Horas excedentes (se houver)
- Percentual de conclusão

### Ordenação

Os membros são ordenados do maior para o menor percentual de conclusão. Membros com capacidade zero são omitidos do gráfico.

---

## Burndown Chart — Análise de Burn da Sprint

O gráfico mais completo do dashboard. Mostra a evolução do trabalho restante ao longo dos dias úteis da sprint.

### Cabeçalho do gráfico

- **Título** — "Análise de Burn da Sprint"
- **Subtítulo** — quantidade de dias úteis da sprint
- **Planejamento** — Inicial Xh | Final Xh | Delta +Xh (scope adicionado)
- **Badge de status** — situação atual da sprint (ver abaixo)

---

### Mini-cards de métricas

Quatro cards acima do gráfico mostram os números mais importantes:

| Card | O que mostra |
|---|---|
| **Restante** | Horas restantes atualmente na sprint |
| **Concluído** | Horas já concluídas e percentual da sprint |
| **Vel. Média** | Velocidade média real (h/dia) e velocidade necessária para terminar no prazo |
| **Dias Restantes** | Dias úteis restantes e progresso (trabalhados / total) |

**Velocidade necessária** é calculada como:
```
horas restantes / dias úteis restantes
```

Se a velocidade média atual for menor que a necessária, o time precisará acelerar para entregar no prazo.

---

### Linhas do gráfico

O gráfico combina quatro séries de dados, todas opcionalmente visíveis via checkbox na legenda:

#### Ideal (azul, área preenchida)

Linha que representa o ritmo ideal de burn para concluir tudo no último dia útil.

**Como é calculada:** no primeiro dia, a linha parte do total de horas planejadas e desce linearmente até zero no último dia. Quando o escopo muda (work items adicionados), a linha é **recalculada a partir daquele ponto** — ela se adapta ao novo total, redistribuindo o trabalho restante pelos dias que ainda sobram.

> Esse comportamento é chamado de *piecewise ideal burn*. Diferente de uma linha reta fixa desde o início, esta linha reflete o escopo real de cada momento.

---

#### Remaining — Trabalho Restante (laranja)

Linha que mostra o `remainingWork` total da sprint em cada dia, obtido dos snapshots diários.

- Quando desce mais rápido que a linha Ideal: o time está **adiantado**
- Quando desce mais devagar: o time está **atrasado**
- Quando sobe: houve adição de escopo naquele dia
- A linha **para no dia de hoje** — dias futuros não têm valor real

---

#### Projeção (roxo, tracejado)

Extrapolação do trabalho restante nos dias futuros, baseada na **velocidade média** dos dias já trabalhados.

**Como é calculada:**
```
velocidade média = (total planejado − restante atual) / dias trabalhados
projeção D+n = restante atual − (velocidade média × n)
```

- Se a linha de projeção chegar a zero **antes** do último dia: o time está no caminho certo para terminar antes do fim da sprint
- Se a linha de projeção **não chegar a zero** no último dia: há risco de não entrega

---

#### Mudanças de Escopo (barras vermelhas)

Barras verticais que aparecem nos dias em que o `totalWork` aumentou. A altura representa quantas horas foram adicionadas naquele dia.

> Scope creep frequente (muitas barras) indica instabilidade de planejamento. Verificar se os requisitos estavam bem definidos antes do início da sprint.

---

### Badge de status (canto superior direito)

Classifica a saúde do burndown com base no desvio entre o trabalho restante atual e o ideal:

| Status | Condição | Cor |
|---|---|---|
| Adiantado | Desvio < −5% | Verde |
| No Prazo | Desvio entre −5% e +5% | Azul |
| Em Risco | Desvio entre +5% e +15% | Âmbar |
| Atrasado | Desvio > +15% | Vermelho |

**Cálculo do desvio:**
```
desvio% = (remaining_atual − ideal_hoje) / total_horas × 100
```

Um desvio **positivo** significa que há mais trabalho restante do que deveria haver segundo o ideal — ou seja, o time está atrasado. Um desvio **negativo** indica que está adiantado.

---

### Interatividade

- **Hover no gráfico** — exibe tooltip com os valores exatos do dia: Ideal, Remaining, Projeção e Escopo adicionado
- **Checkboxes da legenda** — ativa/desativa individualmente cada série
- **Dias off** — fins de semana e dias off configurados são excluídos do eixo X (apenas dias úteis são exibidos)

---

## Fluxo Acumulado da Sprint (Cumulative Flow Diagram)

Gráfico de áreas empilhadas que mostra a evolução diária da quantidade de work items em cada estado ao longo da sprint.

### Camadas

O gráfico empilha quatro camadas, de baixo para cima:

| Camada | Cor | Dado |
|---|---|---|
| Concluído | Verde (`#48BB78`) | `doneCount` do snapshot |
| Bloqueado | Vermelho (`#FC8181`) | `blockedCount` (subconjunto de In Progress) |
| Em Progresso | Azul (`#63B3ED`) | `inProgressCount` menos bloqueados |
| A Fazer | Cinza (`#CBD5E1`) | `todoCount` do snapshot |

> A camada "Bloqueado" só aparece se houver pelo menos um item bloqueado em algum dia da sprint.

### Badge de total

No canto superior direito, um badge exibe a quantidade total de itens na sprint.

### Eixo X

Apenas dias úteis são exibidos (fins de semana e dias off configurados são excluídos). Os rótulos aparecem no formato `Seg 03/02` (dia da semana abreviado + data).

### Tooltip

Ao passar o mouse sobre o gráfico, o tooltip exibe os valores de cada camada mais o total do dia.

### Como interpretar

- **Banda "Concluído" crescendo** — time está entregando, progresso saudável
- **Banda "A Fazer" alargando** — o time não está puxando trabalho, possível impedimento
- **Banda "Em Progresso" alargando** — itens ficando travados, possível gargalo
- **Banda "Bloqueado" aparecendo** — impedimentos ativos que precisam ser resolvidos
- **Todas as bandas convergindo para "Concluído" no final** — sprint bem-sucedida

### Dados

O CFD usa os mesmos snapshots diários do Burndown (`GET /sprints/:id/burndown`), especificamente os campos `todoCount`, `inProgressCount`, `doneCount` e `blockedCount` de cada `SprintSnapshot`.

---

## Distribuição de Work Items

Três gráficos donut lado a lado que mostram como os work items da sprint estão distribuídos.

> Estes gráficos filtram apenas tipos operacionais: Task, Bug, Test Suite, Test Case e Test Plan. PBIs, Features e Epics são excluídos.

### Work Items por Estado

Donut que agrupa os work items pelo estado atual (New, To Do, In Progress, Done, etc.).

**Cores por estado:**

| Estado | Cor |
|---|---|
| New | Cinza |
| To Do / Active / Approved | Azul claro |
| Committed | Azul |
| In Progress | Laranja |
| In Test | Roxo |
| Done / Closed | Verde |
| Removed | Vermelho |

O centro do donut exibe a contagem total de itens. A legenda abaixo mostra cada estado com sua contagem.

### Work Items por Tipo

Donut que agrupa os work items pelo tipo.

**Cores por tipo:**

| Tipo | Cor |
|---|---|
| Task | Azul |
| Bug | Vermelho |
| Test Suite | Roxo escuro |
| Test Case | Roxo médio |
| Test Plan | Roxo claro |

### Work Items por Membro

Donut que agrupa os work items pelo responsável (assignedTo).

- Cada membro recebe uma cor de uma paleta de 15 cores
- Itens sem responsável aparecem como "Não Alocados" em cinza
- Nomes são abreviados automaticamente: primeiro nome quando único, primeiro + último quando há ambiguidade

---

## Work Item Aging

Painel que analisa o "envelhecimento" de Tasks que estão "In Progress", comparando o tempo real gasto com o tempo esperado baseado no esforço e capacidade do responsável.

### Cards de resumo

Três cards coloridos mostram a distribuição:

| Card | Cor | Condição |
|---|---|---|
| Crítico | Vermelho | Ratio > 1.2 (item levando mais de 120% do esperado) |
| Atenção | Âmbar | Ratio entre 1.0 e 1.2 (item levando mais que o esperado) |
| No prazo | Verde | Ratio ≤ 1.0 (item dentro do esperado) |

### Como o ratio é calculado

```
ratio = horas úteis reais em progresso / horas esperadas
```

**Horas úteis reais:** contabiliza apenas horas de trabalho (8h-17h, excluindo almoço 12h-13h), em dias úteis (sem fins de semana e sem dias off da sprint), desde a data de ativação (`activatedDate`) até agora.

**Horas esperadas:** derivadas do esforço planejado e da capacidade diária do responsável:
```
esforço = max(initialRemainingWork, originalEstimate, completedWork+remainingWork, lastRemainingWork)
         mínimo: 1h

capacidade por hora = capacidade diária do membro / 8h
horas esperadas = esforço / capacidade por hora
```

A capacidade diária vem dos dados de capacidade da sprint (`CapacityComparison`). Se o membro não tiver capacidade definida, usa a média do time (fallback: 5h/dia).

### Modal de detalhes

Ao clicar em "Ver críticos", "Ver atenção" ou "Ver no prazo", abre um modal com a lista filtrada de work items. Para cada item:

- **ID e título** — identificação do work item
- **Responsável** — membro alocado
- **Esforço** — horas planejadas
- **Capacidade/dia** — capacidade diária do responsável
- **Badge** — dias reais / dias esperados
- **Botão "Ver detalhes"** — expande detalhes adicionais:
  - Horas previstas
  - Início em progresso
  - Dias e horas úteis em atraso
  - Link "Abrir no Azure DevOps" (requer `VITE_AZURE_DEVOPS_ORG_URL` configurada no `.env`)

### Filtros do modal

No topo do modal, botões permitem alternar entre: Todos, Críticos, Atenção e No prazo.

---

## Dicas de uso

**A velocidade necessária é muito maior que a atual?**
Verifique o painel de Blockers — impedimentos não resolvidos reduzem a velocidade do time.

**O Health Score caiu para "Atenção" ou "Crítico"?**
Clique na seção "Por que essa nota?" para ver quais fatores estão contribuindo. Cada penalidade aponta para um problema específico (sobrecarga, atraso, blockers).

**O balanço de capacidade está muito negativo?**
O time está comprometendo mais horas do que tem disponível. Considere revisar o escopo da sprint ou redistribuir tarefas.

**As barras de escopo aparecem com frequência?**
Indica que itens novos estão sendo adicionados durante a sprint. Isso impacta a linha ideal e pode ser a causa de atrasos.

**Os dados não estão atualizando?**
O sync automático ocorre a cada hora. Para forçar uma atualização imediata, um administrador pode disparar um sync incremental via API (`POST /sync/incremental`) ou aguardar o próximo ciclo.

**O CFD mostra bandas alargando?**
Indica gargalo no fluxo. Se a banda "A Fazer" cresce, o time não está puxando trabalho. Se "Em Progresso" cresce, há itens travados. Verifique os blockers e redistribua tarefas.

**Muitos itens no Aging "Crítico"?**
Revise as estimativas de esforço ou verifique se a capacidade diária dos membros está correta no Azure DevOps. Itens sem estimativa recebem um mínimo de 1h, o que pode distorcer o ratio.

**A distribuição por membro está desigual?**
Use o gráfico "Work Items por Membro" para identificar sobrecarga e redistribuir tarefas. Itens "Não Alocados" não entram no cálculo de capacidade.

**Os links "Abrir no Azure DevOps" não funcionam no Aging?**
Configure a variável `VITE_AZURE_DEVOPS_ORG_URL` no arquivo `.env` do frontend com a URL da sua organização (ex: `https://dev.azure.com/sua-organizacao`).
