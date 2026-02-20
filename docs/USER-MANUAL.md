# 📖 AzureBridge — Manual do Usuário

> Guia completo para usar o dashboard e interpretar cada indicador, gráfico e métrica exibida.

---

## 📋 Índice

- [Verificação de conexão](#-verificação-de-conexão)
- [Navegação básica](#️-navegação-básica)
- [Cabeçalho da Sprint](#-cabeçalho-da-sprint)
- [Cards de Métricas](#-cards-de-métricas)
- [Barra de Progresso da Sprint](#-barra-de-progresso-da-sprint)
- [Sprint Health Score](#-sprint-health-score)
- [Blockers Ativos](#-blockers-ativos)
- [Capacidade vs Planejado](#-capacidade-vs-planejado)
- [Capacidade por Pessoa](#-capacidade-por-pessoa)
- [Burndown Chart](#-burndown-chart--análise-de-burn-da-sprint)
- [Fluxo Acumulado (CFD)](#-fluxo-acumulado-da-sprint-cumulative-flow-diagram)
- [Distribuição de Work Items](#-distribuição-de-work-items)
- [Work Item Aging](#⏳-work-item-aging)
- [Dicas de uso](#-dicas-de-uso)

---

## 🔗 Verificação de conexão

Ao abrir o AzureBridge, o sistema verifica automaticamente a conexão com o servidor backend:

- A tela exibe **"Conectando ao Servidor..."** com uma barra de progresso animada
- O frontend faz polling a cada 2 segundos no endpoint `/api/health`
- Se o servidor responder com sucesso, o dashboard é carregado normalmente
- Após ~2 minutos sem resposta, exibe uma tela de erro com o botão **"Tentar Novamente"**

> Essa verificação é útil quando os serviços em nuvem (Supabase, containers) ainda estão inicializando.

---

## 🗂️ Navegação básica

### Seletor de projeto

No canto superior direito do dashboard há um seletor de projeto. O sistema lista todos os projetos Azure DevOps sincronizados que possuem sprint ativa.

Ao selecionar um projeto, o dashboard exibe automaticamente os dados da sprint ativa daquele projeto.

> Se não houver sprint ativa: **"Nenhuma sprint ativa encontrada no momento."**

---

## 📌 Cabeçalho da Sprint

No topo do conteúdo, são exibidos:

| Campo | Exemplo |
|---|---|
| Nome da sprint | `Sprint 45` |
| Período | `27/01/2026 - 07/02/2026` |

---

## 📊 Cards de Métricas

Cinco cards exibem os indicadores principais da sprint ativa:

### 👥 Capacidade Total

Total de horas disponíveis do time na sprint, descontando dias off (férias, feriados, folgas) configurados no Azure DevOps.

> **Exemplo:** Time com 5 membros × 8h/dia × 10 dias úteis = 400h teóricas. Se um membro tem 2 dias de folga (−16h), a capacidade total fica **384h**.

---

### 🎯 Planejamento

Horas totais planejadas nos work items da sprint. Exibe três valores:

| Valor | Descrição |
|---|---|
| **Inicial** | Total de `originalEstimate` dos work items no início da sprint |
| **Final** | Total atual (pode ter aumentado com scope creep) |
| **Delta** | Diferença entre Final e Inicial (`+Xh` se houve adição de escopo) |

> Delta **positivo** (vermelho) significa que o escopo cresceu após o início da sprint.

---

### ⏰ Restante

Total de horas de `remainingWork` em todos os work items ativos da sprint. Representa o trabalho que ainda precisa ser feito.

---

### ✅ Concluído

Horas de trabalho já concluídas na sprint, obtidas do campo `completedWork` do snapshot mais recente do burndown.

> Quando há snapshots disponíveis, os cards de Planejamento, Restante e Concluído usam os valores do burndown para maior precisão. Sem snapshots, os dados da capacidade são usados como fallback.

---

### 🚨 Impedimentos

Quantidade de work items com `isBlocked = true`. Um item é considerado bloqueado quando seu estado no Azure DevOps é alterado para "Impedido" ou a tag de bloqueio é ativada.

---

## 📈 Barra de Progresso da Sprint

Exibida abaixo dos cards, mostra o percentual de conclusão com base em horas, comparando o progresso real com o ideal do dia.

**Cálculo:**
```
% concluído = completedWork / totalWork × 100
```

### Elementos visuais

| Elemento | Significado |
|---|---|
| Barra azul | Percentual concluído (vermelha se o restante ultrapassar o total planejado) |
| Marcador vertical escuro | Posição ideal de progresso para hoje (modelo piecewise) |
| Badge "Escopo +Xh" | Indica que houve adição de escopo durante a sprint |

### Status de progresso

| Status | Condição | Cor |
|---|---|---|
| ✅ Adiantado | Desvio ≤ −5% | Verde |
| 🔵 No Prazo | −5% < Desvio ≤ +5% | Azul |
| ⚠️ Em Risco | +5% < Desvio ≤ +15% | Âmbar |
| 🔴 Atrasado | Desvio > +15% | Vermelho |

**Cálculo do desvio:**
```
desvio_horas = remaining_atual − ideal_remaining_hoje
desvio% = desvio_horas / totalWork × 100
```

---

## 🏥 Sprint Health Score

Score de **0 a 100** representando a saúde geral da sprint. O score começa em 100 e penalidades são subtraídas conforme os problemas detectados.

### Tabela de penalidades

| Situação | Penalidade |
|---|---|
| Capacidade utilizada < 60% (time ocioso) | −15 |
| Capacidade utilizada > 90% (alta pressão) | −10 |
| Capacidade utilizada > 100% (sobrecarga) | −20 |
| Desvio progresso vs tempo > 10% | −10 |
| Desvio progresso vs tempo > 20% | −20 |
| Desvio progresso vs tempo > 30% | −30 |
| Cada blocker ativo (máx. 4) | −5 por blocker |
| Sprint fora do tracking (`isOnTrack = false`) | −10 |

> **Desvio de progresso:** diferença entre % do tempo decorrido e % de horas concluídas.
> Exemplo: 60% do tempo passou, mas apenas 30% do trabalho foi concluído → desvio de 0.30 → penalidade de −30.

### Classificações

| Score | Classificação |
|---|---|
| 80 – 100 | ✅ Excelente |
| 60 – 79 | 🔵 Bom |
| 40 – 59 | ⚠️ Atenção |
| 0 – 39 | 🔴 Crítico |

A seção **"Por que essa nota?"** lista cada penalidade aplicada. Se não houve penalidades: "Sem penalidades."

---

## 🚨 Blockers Ativos

Painel que lista os work items com `isBlocked = true`.

**Sem blockers:** exibe uma mensagem de celebração.

**Com blockers:**
- Fundo âmbar de alerta
- Cada item mostra: ID (`#1234`), tipo, título e **há quanto tempo está bloqueado**

> O sistema atualiza o status automaticamente no próximo sync (geralmente a cada 1 hora). Para forçar atualização, veja a seção de Dicas.

---

## 👥 Capacidade vs Planejado

Tabela que compara a capacidade disponível com o trabalho planejado por membro.

### Resumo

| Campo | Significado |
|---|---|
| Total Disponível | Soma das `availableHours` de todos os membros |
| Total Planejado | Soma das horas planejadas nos work items |
| Balanço | `Disponível − Planejado` |

- **Balanço verde (+)** — o time tem mais capacidade do que trabalho planejado
- **Balanço vermelho (−)** — o time está planejando mais trabalho do que tem capacidade

### Alerta de trabalho não alocado

Se houver work items sem responsável, um alerta âmbar aparece mostrando a quantidade de itens e o total de horas não alocadas.

> Itens sem responsável não entram no cálculo de capacidade por membro, podendo distorcer o balanço.

---

## 📊 Capacidade por Pessoa

Gráfico de barras horizontais empilhadas mostrando o progresso individual de cada membro.

### Legenda de cores

| Cor | Significado |
|---|---|
| 🔵 Azul | Horas concluídas (dentro da capacidade) |
| ⬜ Cinza | Horas restantes para atingir a capacidade |
| 🟡 Âmbar | Horas excedentes (acima da capacidade — sobrecarga) |

O tooltip exibe: capacidade disponível, horas concluídas, restantes, excedentes e percentual de conclusão.

> Membros são ordenados do maior para o menor percentual de conclusão. Membros com capacidade zero são omitidos.

---

## 📉 Burndown Chart — Análise de Burn da Sprint

O gráfico principal do dashboard. Mostra a evolução do trabalho restante ao longo dos dias úteis da sprint.

### Mini-cards de métricas

| Card | O que mostra |
|---|---|
| **Restante** | Horas restantes atualmente |
| **Concluído** | Horas concluídas e percentual da sprint |
| **Vel. Média** | Velocidade real (h/dia) vs velocidade necessária |
| **Dias Restantes** | Dias úteis restantes e trabalhados / total |

> Se a **velocidade necessária** for maior que a média atual, o time precisará acelerar.

### Séries do gráfico

Todas são opcionalmente visíveis via checkbox na legenda:

#### 🔵 Ideal (área preenchida)

Linha que representa o ritmo ideal de burn. No primeiro dia parte do total planejado e desce até zero no último dia. Quando o escopo muda, é **recalculada a partir daquele ponto** (*piecewise ideal burn*) — diferente de uma linha reta fixa desde o início.

---

#### 🟠 Remaining — Trabalho Restante

Mostra o `remainingWork` total em cada dia. Para no dia de hoje — dias futuros não têm valor real.

- Desce mais rápido que o Ideal → **adiantado**
- Desce mais devagar → **atrasado**
- Sobe → adição de escopo naquele dia

---

#### 🟣 Projeção (tracejado)

Extrapolação do trabalho restante nos dias futuros, baseada na velocidade média:

```
velocidade média = (total planejado − restante atual) / dias trabalhados
projeção D+n = restante atual − (velocidade média × n)
```

- Projeção chega a zero antes do último dia → time no caminho para entregar
- Projeção não chega a zero → risco de não entrega

---

#### 🔴 Mudanças de Escopo (barras)

Barras verticais nos dias em que houve adição de work items ao escopo. Dados vêm de `addedCount`/`removedCount` dos snapshots (histórico real).

> Scope creep frequente indica instabilidade de planejamento.

---

#### 🟢 Concluído no dia (barras)

Barras verticais mostrando horas concluídas por dia (diferença acumulada de `completedWork`).

> Útil para identificar dias de baixa produtividade.

---

### Badge de status

| Status | Condição |
|---|---|
| ✅ Adiantado | Desvio < −5% |
| 🔵 No Prazo | −5% ≤ Desvio ≤ +5% |
| ⚠️ Em Risco | +5% < Desvio ≤ +15% |
| 🔴 Atrasado | Desvio > +15% |

---

## 🌊 Fluxo Acumulado da Sprint (Cumulative Flow Diagram)

Gráfico de áreas empilhadas mostrando a evolução diária da quantidade de work items por estado.

### Camadas (de baixo para cima)

| Camada | Cor | Dado |
|---|---|---|
| ✅ Concluído | Verde | `doneCount` |
| 🔴 Bloqueado | Vermelho | `blockedCount` (subconjunto de In Progress) |
| 🔵 Em Progresso | Azul | `inProgressCount` menos bloqueados |
| ⬜ A Fazer | Cinza | `todoCount` |

> A camada "Bloqueado" só aparece se houver pelo menos um item bloqueado em algum dia da sprint.

### Como interpretar

| Padrão | Significado |
|---|---|
| Banda "Concluído" crescendo | Progresso saudável ✅ |
| Banda "A Fazer" alargando | Time não está puxando trabalho ⚠️ |
| Banda "Em Progresso" alargando | Itens travados, possível gargalo ⚠️ |
| Banda "Bloqueado" aparecendo | Impedimentos ativos — resolver urgente 🚨 |
| Todas as bandas em "Concluído" no final | Sprint bem-sucedida ✅ |

---

## 🍩 Distribuição de Work Items

Três gráficos donut lado a lado mostrando a distribuição dos work items da sprint.

> Filtram apenas tipos operacionais: **Task**, **Bug** e **Test Case**. PBIs, Features e Epics são excluídos.

### Por Estado

Agrupa por estado atual com cores:

| Estado | Cor |
|---|---|
| New | Cinza |
| To Do / Active / Approved | Azul claro |
| In Progress | Laranja |
| In Test | Roxo |
| Done / Closed | Verde |
| Removed | Vermelho |

### Por Tipo

| Tipo | Cor |
|---|---|
| Task | Azul |
| Bug | Vermelho |
| Test Case | Roxo |

### Por Membro

Cada membro recebe uma cor de uma paleta de 15 cores. Itens sem responsável aparecem como **"Não Alocados"** em cinza.

---

## ⏳ Work Item Aging

Analisa o "envelhecimento" de Tasks "In Progress", comparando o tempo real gasto com o tempo esperado baseado no esforço e capacidade do responsável.

### Cards de resumo

| Card | Condição |
|---|---|
| 🔴 Crítico | Ratio > 1.2 (levando mais de 120% do esperado) |
| ⚠️ Atenção | 1.0 < Ratio ≤ 1.2 (levando mais que o esperado) |
| ✅ No prazo | Ratio ≤ 1.0 (dentro do esperado) |

### Cálculo do ratio

```
ratio = horas úteis reais em progresso / horas esperadas

horas úteis reais: considera apenas 8h-17h (menos 1h almoço),
                   dias úteis, desde activatedDate até agora

horas esperadas: esforço / capacidade diária do responsável
  esforço = max(initialRemainingWork, originalEstimate,
                completedWork+remainingWork, lastRemainingWork)
  (mínimo: 1h)
```

### Modal de detalhes

Ao clicar nos cards, abre modal com lista de itens. Para cada work item:

- ID e título
- Responsável e badge de status
- Horas previstas vs capacidade diária
- Data de início em progresso (ativação)
- Previsão de conclusão calculada em horas úteis
- Link **"Abrir no Azure DevOps"** _(requer `VITE_AZURE_DEVOPS_ORG_URL` configurada)_

---

## 💡 Dicas de uso

**A velocidade necessária é muito maior que a atual?**
→ Verifique o painel de Blockers — impedimentos não resolvidos reduzem a velocidade.

**O Health Score caiu para "Atenção" ou "Crítico"?**
→ Veja "Por que essa nota?" para identificar quais fatores estão contribuindo.

**O balanço de capacidade está muito negativo?**
→ O time está comprometendo mais horas do que tem disponível. Revise o escopo ou redistribua tarefas.

**As barras de escopo aparecem com frequência?**
→ Itens novos estão sendo adicionados durante a sprint. Isso impacta a linha ideal e pode causar atrasos.

**Os dados não estão atualizando?**
→ O sync automático ocorre a cada hora. Para forçar atualização imediata: `POST /sync/incremental` via API.

**O CFD mostra bandas alargando?**
→ Gargalo no fluxo. Banda "A Fazer" crescendo: time não está puxando trabalho. Banda "Em Progresso" crescendo: itens travados.

**Muitos itens no Aging "Crítico"?**
→ Revise as estimativas de esforço ou verifique se a capacidade diária dos membros está correta no Azure DevOps.

**Os links "Abrir no Azure DevOps" não funcionam no Aging?**
→ Configure `VITE_AZURE_DEVOPS_ORG_URL=https://dev.azure.com/sua-organizacao` no `.env` do frontend.
