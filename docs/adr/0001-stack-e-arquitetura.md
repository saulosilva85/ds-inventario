# ADR 0001 — Stack e arquitetura

- Status: aceito (revisável após o spike do coletor)
- Data: 2026-10-30

## Contexto
O DS Inventário coleta recursos de nuvem (AWS e GCP) de vários clientes, guarda histórico
e exibe tudo num painel. Coletas podem ser longas; o isolamento entre clientes é crítico.

## Decisão
- TypeScript estrito em todo o projeto (monorepo com npm workspaces).
- Supabase (Postgres, Auth, RLS) como banco e autenticação.
- Frontend em Next.js + React + Tailwind (a criar na fase 1).
- Workers de coleta em Node.js em contêiner, com fila no Postgres (pg-boss), porque
  funções com limite de tempo não comportam coletas longas.
- Lógica de domínio sem dependência de infraestrutura em `packages/core`, testável isoladamente.

## Consequências
- Um só idioma no projeto inteiro.
- Hospedagem dos workers (Fly.io, Railway ou Cloud Run) será decidida após o spike.
