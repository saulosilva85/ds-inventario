import type { ChangeKind, NormalizedResource, ScanError } from '@ds/core';

/** Linha da tabela `resources` (ativa ou já removida) de UMA conexão. */
export interface StoredResource extends NormalizedResource {
  id: string;
  configHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** null = ativo. */
  removedAt: string | null;
}

export type ScanStatus = 'succeeded' | 'partial' | 'failed';

/** Campos de uma linha existente que precisam ser regravados. */
export interface ResourcePatch {
  name: string | null;
  state: string | null;
  tags: Record<string, string>;
  config: Record<string, unknown>;
  configHash: string;
  lastSeenAt: string;
  /** Sempre null: atualizar/reativar um recurso o deixa ativo. */
  removedAt: null;
}

export interface PlannedUpdate {
  id: string;
  patch: ResourcePatch;
}

/** Linha da tabela `resource_changes`. */
export interface PlannedChange {
  resourceId: string;
  kind: ChangeKind;
  diff: Record<string, unknown>;
  occurredAt: string;
}

export interface IngestSummary {
  status: ScanStatus;
  created: number;
  changed: number;
  removed: number;
  errors: ScanError[];
}

/**
 * Tudo o que o worker deve gravar após uma coleta, numa ÚNICA transação:
 * - `inserts`: recursos novos
 * - `updates`: recursos alterados ou reativados
 * - `touches`: recursos vistos sem mudança (só atualizam `last_seen_at`)
 * - `removals`: recursos a marcar com `removed_at = at`
 * - `changes`: eventos de histórico
 * - `summary`: dados da linha de `scan_runs`
 */
export interface IngestPlan {
  at: string;
  inserts: StoredResource[];
  updates: PlannedUpdate[];
  touches: string[];
  removals: string[];
  changes: PlannedChange[];
  summary: IngestSummary;
}
