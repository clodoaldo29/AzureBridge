# Guia de Preenchimento do Template RDA — Descritivo dos Placeholders

## Versão: 2.0 | Atualizado: Fevereiro 2026
## Template: Template_RDA_Com_Loops.docx (com suporte a loops docxtemplater)

---

## Estrutura de Dados para o docxtemplater

O template usa a seguinte estrutura JSON para preenchimento:

```json
{
  "PROJETO_NOME": "string",
  "ANO_BASE": "string",
  "COMPETENCIA": "string",
  "COORDENADOR_TECNICO": "string",
  "ATIVIDADES": [
    {
      "NUMERO_ATIVIDADE": "string",
      "NOME_ATIVIDADE": "string",
      "PERIODO_ATIVIDADE": "string",
      "DESCRICAO_ATIVIDADE": "string",
      "JUSTIFICATIVA_ATIVIDADE": "string",
      "RESULTADO_OBTIDO_ATIVIDADE": "string",
      "DISPENDIOS_ATIVIDADE": "string",
      "RESPONSAVEIS": [
        {
          "NOME_RESPONSAVEL": "string",
          "CPF_RESPONSAVEL": "string",
          "JUSTIFICATIVA_RESPONSAVEL": "string"
        }
      ]
    }
  ],
  "RESULTADOS_ALCANCADOS": "string"
}
```

---

## Regra Geral — Links de Evidência

Os campos narrativos do RDA (DESCRICAO_ATIVIDADE, RESULTADO_OBTIDO_ATIVIDADE, DISPENDIOS_ATIVIDADE e RESULTADOS_ALCANCADOS) devem incluir **links de evidência** sempre que disponíveis nos documentos fonte. Links são a principal forma de comprovar a existência das entregas citadas.

### Tipos de links que o sistema deve coletar e preservar

| Categoria | Origem | Formato da URL | Exemplo de uso no RDA |
|---|---|---|---|
| **Sprint (Taskboard)** | Azure DevOps API | `https://dev.azure.com/{org}/{projeto}/_sprints/taskboard/...` | "Planejamento e acompanhamento da Sprint 3: <URL>" |
| **Wiki do Projeto** | Azure DevOps Wiki | `https://dev.azure.com/{org}/{projeto}/_wiki/wikis/...` | "Documentação de Arquitetura: <URL>" |
| **Delivery Plan** | Azure DevOps | `https://dev.azure.com/{org}/{projeto}/_deliveryplans/...` | "Plano de iterações/entregas: <URL>" |
| **Backlog / Work Items** | Azure DevOps | `https://dev.azure.com/{org}/{projeto}/_workitems/edit/{id}` | "Conforme registrado no item #4521: <URL>" |
| **Protótipos / Design** | Figma | `https://www.figma.com/design/...` ou `https://www.figma.com/file/...` | "Protótipos das telas: <URL>" |
| **Documentos compartilhados** | SharePoint / OneDrive | `https://{org}.sharepoint.com/...` ou `https://{org}-my.sharepoint.com/...` | "Plano de Trabalho: <URL>" |
| **Cronograma** | MS Planner / Project | `https://planner.cloud.microsoft/...` | "Cronograma detalhado: <URL>" |
| **Caminhos de rede** | Servidor interno | `\\servidor\caminho\...` | "Relatório de Status: (...) \\servidor\pasta\" |

### Regras para os agentes de IA

1. **Sempre preservar links encontrados nos chunks:** Durante a extração (ExtractorAgent), qualquer URL presente no conteúdo dos chunks deve ser capturada como parte da evidência, incluindo o contexto em que aparece.
2. **Formato no texto:** Cada entrega citada no RDA deve ser seguida do seu link no formato: `Nome da entrega: <URL completa>;`
3. **Não inventar links:** Se não houver link disponível nos documentos fonte, NÃO gerar URLs. Apenas citar a entrega sem link.
4. **Links do Azure DevOps são construíveis:** Mesmo que o link exato não esteja num chunk, o sistema pode construir URLs de Sprint e Work Items a partir dos dados da API do Azure DevOps (organização + projeto + sprint name ou work item ID).
5. **Agrupar por entregável:** Ao listar resultados com links, usar formato de lista com marcadores para facilitar a leitura.

### Impacto no pipeline de ingestão (chunking)

O serviço de chunking **deve preservar URLs intactas** dentro dos chunks. Regras específicas:
- URLs não devem ser quebradas entre chunks (se uma URL estiver na fronteira, incluir no chunk anterior)
- URLs encontradas em Wiki pages e Work Items devem ser armazenadas nos metadados do chunk: `metadata.urls: string[]`
- Links do Figma e SharePoint encontrados em descrições de Work Items devem ser preservados

---

## BLOCO 1 — Identificação do Projeto

Campos estáticos preenchidos uma vez por RDA. Devem ser extraídos do ProjectContext e dos dados do período selecionado.

---

### PROJETO_NOME
- **Tipo:** text (string simples)
- **Obrigatório:** Sim
- **Fonte de dados:** ProjectContext.projectName + Documento de Visão
- **Descrição:** Nome completo e oficial do projeto conforme consta na documentação aprovada e no registro do Azure DevOps.
- **Regras de preenchimento:**
  - Usar o nome exatamente como aparece no Documento de Visão ou Plano de Trabalho
  - Incluir sigla se houver (ex: "PAIR - Plataforma para Automação Inteligente de Retrabalho")
  - Não abreviar nem alterar o nome oficial
- **Exemplo:** "PAIR - Plataforma para Automação Inteligente de Retrabalho"

---

### ANO_BASE
- **Tipo:** text (string simples)
- **Obrigatório:** Sim
- **Fonte de dados:** Parâmetro de geração (período selecionado pelo usuário)
- **Descrição:** Ano-base de execução do projeto referente ao relatório.
- **Regras de preenchimento:**
  - Formato: "YYYY" (4 dígitos)
  - Corresponde ao ano em que as atividades foram executadas
- **Exemplo:** "2026"

---

### COMPETENCIA
- **Tipo:** text (string simples)
- **Obrigatório:** Sim
- **Fonte de dados:** Parâmetro de geração (período selecionado pelo usuário)
- **Descrição:** Mês de competência do relatório, ou seja, o mês em que as atividades descritas foram realizadas.
- **Regras de preenchimento:**
  - Formato: Nome do mês por extenso + ano, em português (ex: "Janeiro/2026")
  - Alternativa aceita: "01/2026" ou "Janeiro de 2026"
  - Deve corresponder exatamente ao período das atividades relatadas
- **Exemplo:** "Janeiro/2026"

---

### COORDENADOR_TECNICO
- **Tipo:** text (string simples)
- **Obrigatório:** Sim
- **Fonte de dados:** ProjectContext.teamMembers (filtrar por role = "Gerente Técnico" ou "Coordenador Técnico")
- **Descrição:** Nome completo do responsável pelo gerenciamento técnico do projeto. É a pessoa que assina e responde tecnicamente pelo relatório.
- **Regras de preenchimento:**
  - Nome completo conforme cadastrado na documentação do projeto
  - Se houver mais de um coordenador, listar o principal
  - Se não encontrar nos documentos, marcar como "[PENDENTE - Informar Coordenador Técnico]"
- **Exemplo:** "Clodoaldo Melo"

---

## BLOCO 2 — Atividades Desenvolvidas no Período

Este bloco é um **loop (array)**. O relatório pode conter N atividades, cada uma gerando um bloco completo com todos os sub-campos. As atividades devem ser identificadas a partir dos Work Items, Sprints e documentação do período no Azure DevOps.

**Critérios para identificação de atividades:**
- Cada área técnica significativa do projeto no período deve gerar uma atividade (ex: "Desenvolvimento Frontend", "Implementação Backend", "Configuração de Infraestrutura")
- Agrupar Work Items relacionados na mesma atividade quando fazem parte do mesmo objetivo
- Não criar atividades genéricas demais (ex: "Desenvolvimento") nem granulares demais (ex: cada task individual)
- Tipicamente um RDA mensal terá entre 3 e 8 atividades

---

### NUMERO_ATIVIDADE
- **Tipo:** text (string)
- **Obrigatório:** Sim
- **Fonte de dados:** Gerado automaticamente pelo FormatterAgent (sequencial)
- **Descrição:** Número sequencial da atividade no relatório, formatado com zero à esquerda.
- **Regras de preenchimento:**
  - Formato: "01", "02", "03", etc.
  - Gerado automaticamente na ordem de inserção das atividades
  - Padronizar com 2 dígitos
- **Exemplo:** "01", "02", "03"

---

### NOME_ATIVIDADE
- **Tipo:** text (string)
- **Obrigatório:** Sim
- **Fonte de dados:** Work Items do Azure DevOps (títulos de Épicos, Features ou User Stories) + Documentação de Requisitos + Wiki
- **Descrição:** Título conciso e descritivo da atividade executada no período. Deve identificar claramente o que foi feito.
- **Regras de preenchimento:**
  - Usar linguagem técnica clara e objetiva
  - Início com verbo no substantivo ou no infinitivo (ex: "Desenvolvimento do módulo..." ou "Implementação da...")
  - Deve corresponder a uma área ou frente de trabalho do projeto conforme documentação
  - Comprimento ideal: 10 a 80 caracteres
  - Vincular ao escopo aprovado no Plano de Trabalho/Delivery Plan quando possível
- **Exemplos:**
  - "Desenvolvimento do Módulo de Autenticação (Keycloak)"
  - "Implementação das Telas de Dashboard em React.js"
  - "Configuração da Infraestrutura de Banco de Dados MySQL"
  - "Treinamento da Equipe em Metodologia Ágil"
  - "Elaboração e Revisão de Documentação Técnica"

---

### PERIODO_ATIVIDADE
- **Tipo:** text (string)
- **Obrigatório:** Sim
- **Fonte de dados:** Work Items do Azure DevOps (datas de criação, modificação e conclusão no período) + Sprints
- **Descrição:** Período efetivo de execução da atividade dentro do mês de competência.
- **Regras de preenchimento:**
  - Formato: "DD/MM/YYYY a DD/MM/YYYY"
  - Deve estar contido dentro do mês de competência do relatório
  - Baseado nas datas reais dos Work Items (data de início da primeira task até data de conclusão/última atualização da última task)
  - Se a atividade perdurou por todo o mês, usar o primeiro e último dia útil
- **Exemplos:**
  - "06/01/2026 a 24/01/2026"
  - "01/02/2026 a 28/02/2026"

---

### DESCRICAO_ATIVIDADE
- **Tipo:** text (string longa — múltiplos parágrafos)
- **Obrigatório:** Sim
- **Fonte de dados:** Work Items (descrições e comentários) + Wiki (documentação técnica) + Documentação de Requisitos + Sprints
- **Descrição:** Descrição detalhada e completa da atividade executada no período. Este é o campo mais importante e extenso do relatório.
- **Regras de preenchimento:**
  - **Mínimo 150 palavras, ideal 200-400 palavras**
  - Estruturar o texto em parágrafos coesos, não em tópicos soltos
  - **Deve obrigatoriamente conter:**
    1. **O que foi feito:** Descrever as ações concretas realizadas (ex: "Foi implementado o módulo de autenticação utilizando Keycloak...")
    2. **Quem participou:** Mencionar a equipe ou papéis envolvidos (ex: "A equipe de backend, composta por 3 desenvolvedores...")
    3. **Ferramentas e metodologias:** Citar tecnologias, frameworks, ferramentas e metodologias utilizadas (ex: "Utilizando React.js 18 com TypeScript, Tailwind CSS e shadcn/ui...")
    4. **Relação com o escopo:** Vincular a atividade às etapas previstas no plano aprovado (ex: "Esta atividade corresponde à Fase 2 do Delivery Plan, especificamente ao marco M3...")
    5. **Entregas produzidas:** Quando aplicável, mencionar entregas documentais, protótipos, releases, etc.
  - **Se houver serviços contratados vinculados:** Descrever o serviço, o fornecedor e como foi utilizado na atividade
  - **Links de evidência:** Quando a descrição mencionar documentos, páginas wiki, sprints ou protótipos, incluir o link correspondente inline (ex: "conforme documentação de arquitetura disponível em: <URL_WIKI>")
  - **Tom:** Formal, técnico, impessoal (3ª pessoa ou voz passiva)
  - **Evidências:** Referenciar Work Items por ID quando possível (ex: "conforme registrado nos itens #4521 e #4523 do backlog")
- **Exemplo:**
  "No período de 06/01 a 24/01/2026, foi realizada a implementação do módulo de autenticação do sistema PAIR, utilizando o servidor de identidade Keycloak integrado ao backend em C#/.NET. A equipe de desenvolvimento backend, composta por dois desenvolvedores seniores, configurou o realm do Keycloak para ambiente de produção, implementou os fluxos de autenticação OAuth2 e OpenID Connect, e desenvolveu os endpoints de autorização na API REST. Para a integração com o frontend React.js, foram criados os hooks de autenticação e os componentes de login e gestão de sessão, utilizando a biblioteca @react-keycloak/web. Esta atividade está alinhada com a Fase 2 do Delivery Plan (Implementação Core), especificamente ao marco M3 - Sistema de Segurança. Os Work Items #4521 (Configuração Keycloak Realm), #4523 (Endpoints de Auth) e #4525 (Telas de Login) foram concluídos com sucesso durante o período. Como evidência, foi gerada a documentação técnica de autenticação na Wiki do projeto, incluindo fluxogramas dos processos de login e refresh token."

---

### JUSTIFICATIVA_ATIVIDADE
- **Tipo:** text (string longa)
- **Obrigatório:** Sim
- **Fonte de dados:** Documento de Visão (objetivos) + Plano de Trabalho (justificativa) + Delivery Plan (fases) + Documentação de Requisitos
- **Descrição:** Justificativa da necessidade da atividade em relação ao objetivo do projeto, demonstrando como ela contribui para a entrega dos resultados.
- **Regras de preenchimento:**
  - **Mínimo 80 palavras, ideal 100-200 palavras**
  - **Deve obrigatoriamente conter:**
    1. **Vinculação ao objetivo:** Por que esta atividade é necessária para o projeto (ex: "O módulo de autenticação é requisito fundamental para garantir a segurança e o controle de acesso ao sistema...")
    2. **Contribuição para resultados:** Como a atividade contribui para os entregáveis finais
    3. **Justificativa de dispêndios:** Se houver gastos vinculados (equipamentos, serviços, viagens), justificar cada um em relação à atividade
  - **Cada despesa deve estar claramente relacionada à atividade descrita**
  - Evitar inconsistências com o SAGAT ou com o plano aprovado
  - Tom formal e técnico
- **Exemplo:**
  "A implementação do módulo de autenticação é requisito fundamental previsto na Fase 2 do Delivery Plan, sendo pré-requisito para todas as funcionalidades que exigem controle de acesso por perfil de usuário. Sem este módulo, o sistema não poderia ser disponibilizado em ambiente de produção, pois não atenderia aos requisitos de segurança da informação exigidos pelo Grupo Multi S.A. A escolha do Keycloak como servidor de identidade justifica-se pela necessidade de suportar múltiplos provedores de autenticação (SSO corporativo) e pela conformidade com os padrões OAuth2/OIDC, atendendo ao Requisito Não-Funcional RNF-005 documentado na Especificação de Requisitos."

---

### RESULTADO_OBTIDO_ATIVIDADE
- **Tipo:** text (string longa — pode incluir referências a gráficos e métricas)
- **Obrigatório:** Sim
- **Fonte de dados:** Work Items concluídos + Sprints (métricas: burndown, velocity) + Wiki (documentação atualizada) + Releases/Deploys
- **Descrição:** Resultados concretos e mensuráveis alcançados com a atividade no período.
- **Regras de preenchimento:**
  - **Mínimo 80 palavras, ideal 100-250 palavras**
  - **Deve obrigatoriamente conter:**
    1. **Entregas concretas:** Relatórios técnicos, protótipos, módulos desenvolvidos, documentação produzida, treinamentos realizados
    2. **Evidências quantitativas sempre que possível:** Percentuais de conclusão, número de funcionalidades, métricas de sprint, linhas de código, cobertura de testes
    3. **Links de evidência para cada entrega:** Este é o campo principal para inclusão de links. Cada entregável citado DEVE ser acompanhado do seu link de acesso quando disponível. Formatar como lista de entregáveis com links:
       - "Planejamento e acompanhamento da Sprint N: <URL_SPRINT_TASKBOARD>;"
       - "Documentação técnica na Wiki: <URL_WIKI_PAGE>;"
       - "Protótipos das telas no Figma: <URL_FIGMA>;"
       - "Backlog do produto: <URL_BACKLOG>;"
       - "Cronograma detalhado: <URL_PLANNER>;"
       - "Plano de Trabalho: <URL_SHAREPOINT>;"
    4. **Status atual:** Se a atividade está 100% concluída ou se é parcial, com estimativa de conclusão
    5. **Próximas etapas:** Se o resultado é parcial, indicar o que falta e quando está previsto
  - Pode referenciar gráficos, imagens e tabelas que complementem as evidências
  - Se o resultado ficou abaixo do esperado, justificar e apresentar plano de recuperação
  - **Construção automática de links:** O sistema pode montar URLs de Sprint e Work Items usando dados da API do Azure DevOps:
    - Sprint: `https://dev.azure.com/{org}/{projeto}/_sprints/taskboard/{team}/{projeto}/{sprint_name}`
    - Work Item: `https://dev.azure.com/{org}/{projeto}/_workitems/edit/{work_item_id}`
    - Wiki: `https://dev.azure.com/{org}/{projeto}/_wiki/wikis/{wiki_name}/{page_id}/{page_path}`
- **Exemplo:**
  "Como resultado da atividade, foram entregues: (1) Módulo de autenticação Keycloak totalmente funcional e integrado ao backend, contemplando 3 endpoints de API (login, logout, refresh-token) e 2 componentes React de interface (tela de login e gerenciamento de sessão); (2) Documentação técnica completa na Wiki do projeto com fluxogramas de autenticação e guia de configuração do Keycloak; (3) Suite de testes automatizados com 94% de cobertura nos serviços de autenticação. Ao total, foram concluídos 8 Work Items (3 User Stories e 5 Tasks), representando 100% do escopo planejado para o marco M3. A velocidade da equipe na Sprint 5 foi de 34 story points, 12% acima da média das sprints anteriores.

  Como entregáveis, foram gerados:
  - Documentação de Autenticação na Wiki: https://dev.azure.com/org/PAIR/_wiki/wikis/PAIR.wiki/1234/Autenticacao-Keycloak;
  - Protótipos das telas de login no Figma: https://www.figma.com/design/AbCdEf123/PAIR-Login;
  - Planejamento e acompanhamento da Sprint 5: https://dev.azure.com/org/PAIR/_sprints/taskboard/PAIR%20Team/PAIR/Sprint%205;
  - Backlog do módulo de segurança: https://dev.azure.com/org/PAIR/_workitems/edit/4521."

---

## BLOCO 2.1 — Responsáveis pela Atividade

Este sub-bloco é um **loop aninhado (array dentro de cada atividade)**. Cada atividade pode ter N responsáveis. Os responsáveis são identificados pelos assignees dos Work Items vinculados à atividade no Azure DevOps.

---

### NOME_RESPONSAVEL
- **Tipo:** text (string)
- **Obrigatório:** Sim
- **Fonte de dados:** Work Items do Azure DevOps (campo Assigned To) + ProjectContext.teamMembers
- **Descrição:** Nome completo do responsável pela execução da atividade.
- **Regras de preenchimento:**
  - Nome completo conforme cadastrado no Azure DevOps ou na documentação do projeto
  - Deve ser alguém que aparece como assignee em Tasks, Bugs ou Test Cases vinculados à atividade
  - Se o mesmo responsável participou de múltiplas atividades, ele aparece em cada uma separadamente
- **Exemplo:** "João Silva Santos"

---

### CPF_RESPONSAVEL
- **Tipo:** text (string)
- **Obrigatório:** Não (preencher se disponível)
- **Fonte de dados:** Documentação administrativa do projeto (se disponível nos documentos indexados)
- **Descrição:** CPF do responsável pela atividade.
- **Regras de preenchimento:**
  - Formato: "XXX.XXX.XXX-XX"
  - Se a informação não estiver disponível nos documentos indexados, deixar em branco (será preenchido manualmente pelo gestor)
  - NUNCA inventar ou estimar um CPF
- **Exemplo:** "123.456.789-00" ou "" (vazio)

---

### JUSTIFICATIVA_RESPONSAVEL
- **Tipo:** text (string)
- **Obrigatório:** Sim
- **Fonte de dados:** Work Items (tipo de tarefa e área) + ProjectContext.teamMembers (role) + Wiki (definição de papéis)
- **Descrição:** Descrição da função e das atribuições do responsável na atividade específica.
- **Regras de preenchimento:**
  - **Mínimo 30 palavras, ideal 40-80 palavras**
  - Descrever o papel técnico na atividade, não apenas o cargo
  - Detalhar as ações específicas realizadas pelo responsável
  - Vincular ao tipo de Work Item que ele executou
- **Exemplos:**
  - "Desenvolvedor Backend: Responsável pela implementação dos endpoints de autenticação na API REST em C#/.NET, configuração do Keycloak realm e integração com o banco de dados MySQL. Executou as tasks #4521 e #4523 relacionadas à camada de segurança do sistema."
  - "Desenvolvedora Frontend: Responsável pela criação dos componentes React.js de login e gestão de sessão, implementação dos hooks de autenticação com @react-keycloak/web e estilização com Tailwind CSS. Conduziu os testes de integração frontend-backend."
  - "Analista de Qualidade: Responsável pela elaboração e execução dos casos de teste de autenticação, incluindo testes de segurança (penetration testing básico), testes de carga e documentação dos resultados no Azure DevOps Test Plans."

---

## BLOCO 2.2 — Dispêndios da Atividade

---

### DISPENDIOS_ATIVIDADE
- **Tipo:** text (string — formato de lista)
- **Obrigatório:** Sim (pode ser "Não houve dispêndios específicos neste período." se não houver)
- **Fonte de dados:** Documentação financeira do projeto (se disponível) + Wiki + Documentos de referência
- **Descrição:** Lista dos dispêndios (gastos) diretamente relacionados à execução da atividade no período.
- **Regras de preenchimento:**
  - Listar cada dispêndio em linha separada com prefixo "- "
  - Para cada dispêndio informar: tipo, fornecedor/empresa e número da NF quando disponível
  - Tipos comuns: Serv. Tecnológico, Equipamento, Licença de Software, Viagem, Material de Consumo
  - Se não houver dispêndios, escrever: "Não houve dispêndios específicos vinculados a esta atividade neste período. Os custos estão associados às horas da equipe técnica interna."
  - NUNCA inventar valores ou fornecedores
- **Exemplos:**
  - "- Serv. Tecnológico: Anthropic Inc., NF 2026-001 (Licença API Claude para assistência no desenvolvimento)\n- Licença de Software: JetBrains, NF 2026-015 (Licença IDE WebStorm anual)"
  - "Não houve dispêndios específicos vinculados a esta atividade neste período. Os custos estão associados às horas da equipe técnica alocada ao projeto."

---

## BLOCO 3 — Resultados Alcançados

---

### RESULTADOS_ALCANCADOS
- **Tipo:** text (string longa — visão consolidada)
- **Obrigatório:** Sim
- **Fonte de dados:** Consolidação de todos os RESULTADO_OBTIDO_ATIVIDADE + Sprints (métricas gerais) + Delivery Plan (marcos atingidos) + Wiki (documentação produzida)
- **Descrição:** Visão consolidada dos resultados alcançados no desenvolvimento do projeto até o momento, não apenas no mês corrente. É um resumo executivo do progresso geral do projeto.
- **Regras de preenchimento:**
  - **Mínimo 150 palavras, ideal 200-350 palavras**
  - **Deve obrigatoriamente conter:**
    1. **Progresso geral do projeto:** Percentual de conclusão em relação ao escopo total, marcos atingidos
    2. **Entregas acumuladas:** Lista consolidada das principais entregas até o momento
    3. **Métricas de produtividade:** Velocity média, work items concluídos, sprints finalizadas
    4. **Destaques do período:** Conquistas importantes do mês corrente
    5. **Perspectiva futura:** Breve menção às próximas etapas previstas
    6. **Links de referência geral:** Incluir links para Delivery Plan, cronograma atualizado e backlog geral quando disponíveis
  - Tom: Formal, objetivo, com foco em resultados mensuráveis
  - Não repetir verbatim as descrições individuais das atividades — sintetizar
  - Deve dar ao leitor uma visão clara do "estado de saúde" do projeto
- **Exemplo:**
  "Até o presente momento, o projeto PAIR alcançou aproximadamente 65% de conclusão do escopo total previsto no Delivery Plan, tendo concluído integralmente as Fases 1 (Planejamento e Arquitetura) e 2 (Implementação Core), e iniciado a Fase 3 (Integração e Testes). No mês de janeiro de 2026, foram concluídos 24 Work Items distribuídos em 4 atividades principais, totalizando 87 story points entregues na Sprint 5. As principais entregas acumuladas do projeto incluem: módulo de autenticação Keycloak integrado, sistema de dashboard com 12 telas funcionais em React.js, API REST com 47 endpoints documentados em C#/.NET, banco de dados MySQL com 32 tabelas e procedimentos de migração, e documentação técnica completa na Wiki com 28 páginas. A velocidade média da equipe nas últimas 3 sprints se manteve estável em 32 story points/sprint, indicando previsibilidade nas entregas. Para o próximo período, está previsto o início dos testes integrados (Fase 3, marco M5) e a preparação do ambiente de homologação."

---

## Notas Técnicas para Implementação

### Construção Automática de URLs do Azure DevOps

O sistema pode construir URLs automaticamente a partir dos dados da API, mesmo quando o link não aparece explicitamente em nenhum chunk. Isso é especialmente útil para Sprints e Work Items.

```typescript
// Serviço de construção de URLs do Azure DevOps
class AzureDevOpsUrlBuilder {
  constructor(
    private organization: string,  // Ex: 'org-name'
    private project: string,       // Ex: 'PAIR'
    private teamName: string,      // Ex: 'PAIR Team'
  ) {}

  // URL do taskboard de uma Sprint
  sprintTaskboard(sprintName: string): string {
    const org = encodeURIComponent(this.organization);
    const proj = encodeURIComponent(this.project);
    const team = encodeURIComponent(this.teamName);
    const sprint = encodeURIComponent(sprintName);
    return `https://dev.azure.com/${org}/${proj}/_sprints/taskboard/${team}/${proj}/${sprint}`;
  }

  // URL de um Work Item específico
  workItem(workItemId: number): string {
    return `https://dev.azure.com/${this.organization}/${encodeURIComponent(this.project)}/_workitems/edit/${workItemId}`;
  }

  // URL de uma página da Wiki
  wikiPage(wikiName: string, pageId: number, pagePath: string): string {
    const proj = encodeURIComponent(this.project);
    const wiki = encodeURIComponent(wikiName);
    const path = encodeURIComponent(pagePath);
    return `https://dev.azure.com/${this.organization}/${proj}/_wiki/wikis/${wiki}/${pageId}/${path}`;
  }

  // URL do Delivery Plan
  deliveryPlan(planId: string): string {
    return `https://dev.azure.com/${this.organization}/${encodeURIComponent(this.project)}/_deliveryplans/plan/${planId}`;
  }

  // URL do backlog
  backlog(): string {
    const proj = encodeURIComponent(this.project);
    const team = encodeURIComponent(this.teamName);
    return `https://dev.azure.com/${this.organization}/${proj}/_backlogs/backlog/${team}/${proj}`;
  }
}
```

### Preservação de Links no Chunking

O ChunkingService deve tratar URLs como tokens atômicos:

```typescript
// No chunking.service.ts — adicionar ao algoritmo de split:

// Regra: URLs não devem ser quebradas entre chunks
private preserveUrls(text: string, splitPoint: number): number {
  // Verificar se o splitPoint cai no meio de uma URL
  const urlRegex = /https?:\/\/[^\s<>)"]+/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const urlStart = match.index;
    const urlEnd = urlStart + match[0].length;
    if (splitPoint > urlStart && splitPoint < urlEnd) {
      // Split cairia no meio da URL — mover para antes da URL
      return urlStart;
    }
  }
  return splitPoint;  // Nenhum conflito
}

// Extração de URLs dos chunks para metadados
private extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>)"]+/g;
  const matches = text.match(urlRegex);
  return matches || [];
}
```

### Metadados de chunk com URLs

```typescript
// Atualizar ChunkMetadata para incluir URLs encontradas:
interface ChunkMetadata {
  // ... campos existentes ...
  urls?: string[];               // URLs encontradas no chunk
  urlTypes?: Array<{             // Classificação das URLs
    url: string;
    type: 'azure_devops_sprint' | 'azure_devops_wiki' | 'azure_devops_workitem' |
          'azure_devops_deliveryplan' | 'figma' | 'sharepoint' | 'planner' | 'other';
  }>;
}

// Classificador de URLs
function classifyUrl(url: string): string {
  if (url.includes('dev.azure.com') && url.includes('_sprints')) return 'azure_devops_sprint';
  if (url.includes('dev.azure.com') && url.includes('_wiki')) return 'azure_devops_wiki';
  if (url.includes('dev.azure.com') && url.includes('_workitems')) return 'azure_devops_workitem';
  if (url.includes('dev.azure.com') && url.includes('_deliveryplans')) return 'azure_devops_deliveryplan';
  if (url.includes('figma.com')) return 'figma';
  if (url.includes('sharepoint.com') || url.includes('-my.sharepoint.com')) return 'sharepoint';
  if (url.includes('planner.cloud.microsoft')) return 'planner';
  return 'other';
}
```

### Configuração do docxtemplater
```javascript
const doc = new Docxtemplater(zip, {
  paragraphLoop: true,    // ESSENCIAL para os loops de atividades
  linebreaks: true,       // Permite \n nas descrições longas
  nullGetter: (part) => {
    if (part.module === 'loop') return [];  // Loops vazios = não renderizar
    return '[PENDENTE]';                     // Campos não preenchidos
  },
});
```

### Exemplo de JSON de preenchimento completo
```json
{
  "PROJETO_NOME": "PAIR - Plataforma para Automação Inteligente de Retrabalho",
  "ANO_BASE": "2026",
  "COMPETENCIA": "Janeiro/2026",
  "COORDENADOR_TECNICO": "Clodoaldo Melo",
  "ATIVIDADES": [
    {
      "NUMERO_ATIVIDADE": "01",
      "NOME_ATIVIDADE": "Implementação do Módulo de Autenticação (Keycloak)",
      "PERIODO_ATIVIDADE": "06/01/2026 a 24/01/2026",
      "DESCRICAO_ATIVIDADE": "No período de 06/01 a 24/01/2026, foi realizada a implementação do módulo de autenticação do sistema PAIR, utilizando o servidor de identidade Keycloak integrado ao backend em C#/.NET. A equipe de desenvolvimento, composta por dois desenvolvedores seniores, configurou o realm do Keycloak para ambiente de produção e implementou os fluxos de autenticação OAuth2 e OpenID Connect, conforme documentação de arquitetura disponível na Wiki do projeto: https://dev.azure.com/org/PAIR/_wiki/wikis/PAIR.wiki/1200/Arquitetura. Os endpoints de autorização foram desenvolvidos na API REST seguindo os padrões definidos nos ADRs do projeto. Para o frontend React.js, foram criados os hooks de autenticação e os componentes de login utilizando a biblioteca @react-keycloak/web, seguindo os protótipos aprovados no Figma: https://www.figma.com/design/AbCdEf123/PAIR-Login. Esta atividade está alinhada com a Fase 2 do Delivery Plan (Implementação Core), especificamente ao marco M3 - Sistema de Segurança.",
      "JUSTIFICATIVA_ATIVIDADE": "A implementação do módulo de autenticação é requisito fundamental previsto na Fase 2 do Delivery Plan, sendo pré-requisito para todas as funcionalidades que exigem controle de acesso por perfil de usuário. Sem este módulo, o sistema não poderia ser disponibilizado em ambiente de produção, pois não atenderia aos requisitos de segurança da informação exigidos pelo Grupo Multi S.A. A escolha do Keycloak justifica-se pela necessidade de suportar múltiplos provedores de autenticação (SSO corporativo) e pela conformidade com os padrões OAuth2/OIDC, atendendo ao Requisito Não-Funcional RNF-005.",
      "RESULTADO_OBTIDO_ATIVIDADE": "Como resultado da atividade, foram entregues: (1) Módulo de autenticação Keycloak totalmente funcional e integrado ao backend, contemplando 3 endpoints de API; (2) Documentação técnica completa na Wiki; (3) Suite de testes com 94% de cobertura. Foram concluídos 8 Work Items totalizando 34 story points.\n\nComo entregáveis, foram gerados:\n- Documentação de Autenticação na Wiki: https://dev.azure.com/org/PAIR/_wiki/wikis/PAIR.wiki/1234/Autenticacao-Keycloak;\n- Protótipos das telas de login no Figma: https://www.figma.com/design/AbCdEf123/PAIR-Login;\n- Planejamento e acompanhamento da Sprint 5: https://dev.azure.com/org/PAIR/_sprints/taskboard/PAIR%20Team/PAIR/Sprint%205;\n- Work Items do módulo de segurança: https://dev.azure.com/org/PAIR/_workitems/edit/4521.",
      "DISPENDIOS_ATIVIDADE": "Não houve dispêndios específicos vinculados a esta atividade neste período. Os custos estão associados às horas da equipe técnica alocada ao projeto.",
      "RESPONSAVEIS": [
        {
          "NOME_RESPONSAVEL": "João Silva Santos",
          "CPF_RESPONSAVEL": "",
          "JUSTIFICATIVA_RESPONSAVEL": "Desenvolvedor Backend: Responsável pela implementação dos endpoints de autenticação na API REST em C#/.NET, configuração do Keycloak realm e integração com o banco de dados MySQL. Executou as tasks #4521 e #4523 relacionadas à camada de segurança do sistema."
        },
        {
          "NOME_RESPONSAVEL": "Maria Oliveira Costa",
          "CPF_RESPONSAVEL": "",
          "JUSTIFICATIVA_RESPONSAVEL": "Desenvolvedora Frontend: Responsável pela criação dos componentes React.js de login e gestão de sessão, implementação dos hooks de autenticação com @react-keycloak/web e estilização com Tailwind CSS."
        }
      ]
    },
    {
      "NUMERO_ATIVIDADE": "02",
      "NOME_ATIVIDADE": "Desenvolvimento das Telas de Dashboard em React.js",
      "PERIODO_ATIVIDADE": "10/01/2026 a 31/01/2026",
      "DESCRICAO_ATIVIDADE": "...",
      "JUSTIFICATIVA_ATIVIDADE": "...",
      "RESULTADO_OBTIDO_ATIVIDADE": "...\n\nComo entregáveis, foram gerados:\n- Planejamento e acompanhamento da Sprint 5: https://dev.azure.com/org/PAIR/_sprints/taskboard/PAIR%20Team/PAIR/Sprint%205;\n- Protótipos do Dashboard no Figma: https://www.figma.com/design/XyZ789/PAIR-Dashboard;\n- Documentação de componentes na Wiki: https://dev.azure.com/org/PAIR/_wiki/wikis/PAIR.wiki/1300/Dashboard-Components.",
      "DISPENDIOS_ATIVIDADE": "...",
      "RESPONSAVEIS": []
    }
  ],
  "RESULTADOS_ALCANCADOS": "Até o presente momento, o projeto PAIR alcançou aproximadamente 65% de conclusão do escopo total previsto no Delivery Plan. No mês de janeiro de 2026, foram concluídos 24 Work Items distribuídos em 4 atividades principais, totalizando 87 story points entregues na Sprint 5.\n\nAs principais referências do projeto estão disponíveis em:\n- Delivery Plan: https://dev.azure.com/org/PAIR/_deliveryplans/plan/abc123;\n- Cronograma detalhado: https://planner.cloud.microsoft/webui/premiumplan/xyz789;\n- Backlog do Produto: https://dev.azure.com/org/PAIR/_wiki/wikis/PAIR.wiki/1000/Backlog."
}
```
