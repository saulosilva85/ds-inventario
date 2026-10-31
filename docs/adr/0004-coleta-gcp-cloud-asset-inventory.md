# ADR 0004 — Coleta do GCP via Cloud Asset Inventory

- Status: aceito (a validar com um projeto real no spike)
- Data: 2026-10-31

## Decisão
O coletor GCP usa a Cloud Asset Inventory API (`assets.list`, conteúdo `RESOURCE`) em vez de
chamar cada serviço (Compute, Cloud SQL, Storage). Uma chamada por tipo lista o tipo em todas as
localizações, então cada tipo de asset é uma unidade de coleta com escopo `region: '*'`.

Tipos da v1: `compute.googleapis.com/Instance`, `Disk`, `Address`, `ForwardingRule`,
`sqladmin.googleapis.com/Instance` e `storage.googleapis.com/Bucket`.

- Balanceadores são representados pelas regras de encaminhamento (`ForwardingRule`); o
  detalhamento (URL maps, backends) fica para uma versão futura.
- O ID nativo é o nome completo do asset (`//compute.googleapis.com/projects/...`), estável e único.
- Zonas são convertidas em região (`southamerica-east1-a` → `southamerica-east1`); a zona original
  permanece em `config`.
- O conteúdo de `resource.data` é tratado como não confiável: cada campo é validado e tipos
  inesperados viram `null`, sem quebrar a coleta.

## Consequências
- Menos código e menos permissões do que uma integração por serviço.
- A API precisa estar habilitada no nosso projeto e a nossa conta de serviço precisa de papel de
  leitura no projeto do cliente (ADR 0002). Ambos serão validados no spike.
