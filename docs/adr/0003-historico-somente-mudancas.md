# ADR 0003 — Histórico guarda só o que mudou

- Status: aceito
- Data: 2026-10-30

## Decisão
A tabela `resources` guarda o estado atual. A tabela `resource_changes` guarda eventos
(criado, alterado, removido) com a diferença, e só quando o conteúdo muda.

Um recurso só é marcado como removido se a sua parte do ambiente (provedor, conta, região,
tipo) foi listada **com sucesso** na coleta (`ScanScope`). Falhas parciais nunca apagam recursos.
Essa regra está implementada e testada em `packages/core/src/diff.ts`.

## Consequências
- Banco enxuto e tela "o que mudou" direta.
- Reconstruir o estado em uma data passada exige reaplicar os eventos.
