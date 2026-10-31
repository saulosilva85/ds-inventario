# ADR 0002 — Acesso à nuvem do cliente

- Status: aceito (a validar com contas reais no spike)
- Data: 2026-10-30

## Decisão
O produto é **somente-leitura** e **não guarda segredos de longa duração** do cliente.

- AWS: o cliente cria uma role IAM com confiança na nossa conta e um External ID único por
  conexão, com política personalizada de mínimo privilégio (`Describe*`, `List*`, `Get*`
  restritos aos serviços da v1). O worker usa `sts:AssumeRole` e credenciais temporárias.
- GCP: o cliente concede papéis de leitura (ex.: Cloud Asset Viewer) à nossa conta de serviço.
  Nenhuma chave JSON é trocada. A coleta usa a Cloud Asset Inventory API.

## Consequências
- Menor impacto em caso de vazamento: não há chaves do cliente para vazar.
- O onboarding precisa de template CloudFormation (AWS) e passo a passo (GCP).
