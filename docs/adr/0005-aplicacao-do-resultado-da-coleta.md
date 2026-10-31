# ADR 0005 — Aplicação do resultado da coleta (`@ds/ingest`)

- Status: aceito
- Data: 2026-11-01

## Decisão
Entre os coletores e o banco existe uma função **pura**, `planIngest`, que recebe o estado
anterior da conexão (linhas ativas e removidas), o resultado da coleta e o instante atual, e
devolve um plano: `inserts`, `updates`, `touches`, `removals`, `changes` (histórico) e `summary`
(dados de `scan_runs`). O worker aplica o plano numa **única transação**.

- Sem relógio, banco nem gerador de IDs dentro da função: tudo é injetado, o que a torna
  determinística e testável sem infraestrutura.
- Recurso removido que reaparece **reaproveita a linha** (a tabela `resources` tem unicidade por
  conexão, região, tipo e ID nativo) e gera um evento "created" com `reappeared: true`.
- Status da execução: `succeeded` (sem erros), `partial` (erros, mas parte coletada) e `failed`
  (erros e nada coletado).
- Recursos de escopos não coletados não são alterados nem marcados como removidos (ADR 0003).

## Regras de planos (`@ds/plans`)
Limites e permissões por plano vivem em uma tabela única (`PLANS`), com funções puras para
decidir conexões, usuários, exportação, frequência de coleta e retenção de histórico. Os valores
são PROPOSTAS aguardando a decisão final de preços (decisão aberta nº 3 da fase 0).

## Pontos em aberto
1. **Proteção contra remoção em massa.** Uma listagem "bem-sucedida" mas anormalmente vazia
   (por exemplo, permissão revogada que não gera erro) apagaria todo o inventário. Avaliar um
   limite (ex.: reter remoções quando mais de 50% dos recursos de um escopo somem de uma vez)
   para confirmar na coleta seguinte.
2. **Política ao exceder o limite de recursos do plano:** apenas avisar, ou parar de inventariar
   novos recursos? Hoje `evaluateResourceUsage` só mede.
