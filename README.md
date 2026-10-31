# DS Inventário

Inventário de recursos de nuvem (**AWS** e **GCP**) com histórico de mudanças e relatórios.
Produto da DS SOLUÇÕES. Site: repositório `site-dstecnologia`.

## Status

Fase 1 — base do projeto. Nada aqui está em produção.

## Estrutura

```
packages/core/        lógica de domínio sem dependências de infraestrutura (testada)
packages/collector-aws/  normalização dos recursos da AWS e orquestração da coleta (testada)
packages/collector-gcp/  normalização dos assets do GCP e orquestração da coleta (testada)
supabase/migrations/  esquema do banco com RLS por organização
docs/adr/             registros de decisões de arquitetura
.github/workflows/    CI (tipos + testes)
```

## Como rodar

Requer Node 22 ou superior.

```bash
npm install
npm run typecheck
npm test
```

## Regras do projeto

- Somente-leitura na nuvem do cliente; nenhum segredo de longa duração do cliente é guardado.
- Toda tabela de negócio tem `organization_id` e RLS ativa.
- Decisões relevantes viram um ADR em `docs/adr/`.
- Nunca commitar segredos (veja `SECURITY.md`).

## Próximos passos

1. Aplicar a migração inicial num projeto Supabase de desenvolvimento.
2. Testes automáticos de isolamento entre organizações (RLS).
3. Adaptadores reais: AWS SDK (paginação, retentativas, `sts:AssumeRole`) e Cloud Asset API do GCP.
4. Aplicação web (Next.js): login, organizações e onboarding.
