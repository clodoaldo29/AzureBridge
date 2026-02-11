# AzureBridge — Manual do Usuário

Este documento explica como usar o dashboard do AzureBridge e o significado de cada indicador, gráfico e informação exibida.

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

Painel com uma linha por membro do time, mostrando o progresso individual de entrega na sprint.

### Para cada membro

- **Nome e avatar** — identificação do membro
- **Horas concluídas / capacidade** — ex: `Concluído 20h de 40h`
- **Barra de progresso** — percentual visual preenchido conforme entrega
- **Badge de status:**

| Status | Quando aparece | Cor |
|---|---|---|
| Dentro | Conclusão < 85% da capacidade | Azul |
| No limite | Conclusão entre 85% e 100% | Verde |
| Acima | Conclusão > 100% da capacidade | Âmbar |

- **Restante para capacidade** — horas que faltam para atingir a meta de capacidade
- **Meta** — capacidade disponível do membro (ou "Acima: +Xh" se ultrapassou)

### Ordenação

Os membros são ordenados do maior para o menor percentual de conclusão.

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
