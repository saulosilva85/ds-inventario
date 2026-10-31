import {
  computeChanges,
  contentHash,
  resourceKey,
  type NormalizedResource,
  type ResourceChange,
  type ScanResult,
} from '@ds/core';
import type {
  IngestPlan,
  PlannedChange,
  PlannedUpdate,
  ResourcePatch,
  ScanStatus,
  StoredResource,
} from './types.ts';

export interface IngestInput {
  /** TODAS as linhas da conexão: ativas e já removidas. */
  previous: readonly StoredResource[];
  scan: ScanResult;
  /** Instante da coleta (ISO 8601). Injetado para manter a função pura. */
  now: string;
  /** Gerador de IDs de novas linhas (UUID na produção). */
  newId: () => string;
}

function indexAll(rows: readonly StoredResource[]): Map<string, StoredResource> {
  const map = new Map<string, StoredResource>();
  for (const row of rows) {
    const key = resourceKey(row);
    if (map.has(key)) throw new Error(`Linha duplicada no estado anterior: ${key}`);
    map.set(key, row);
  }
  return map;
}

function patchFor(r: NormalizedResource, now: string): ResourcePatch {
  return {
    name: r.name,
    state: r.state,
    tags: r.tags,
    config: r.config,
    configHash: contentHash(r),
    lastSeenAt: now,
    removedAt: null,
  };
}

function fieldDiff(change: ResourceChange): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const f of change.changedFields) {
    out[f] = { before: change.before?.[f] ?? null, after: change.after?.[f] ?? null };
  }
  return out;
}

/**
 * Status da execução:
 * - `failed`: houve erros e NADA foi coletado com sucesso;
 * - `partial`: houve erros, mas parte do ambiente foi coletada;
 * - `succeeded`: sem erros.
 */
export function scanStatus(scan: ScanResult): ScanStatus {
  if (scan.errors.length === 0) return 'succeeded';
  return scan.scannedScopes.length === 0 ? 'failed' : 'partial';
}

/**
 * Função pura: transforma o resultado de uma coleta e o estado anterior no
 * plano de gravação. Não acessa banco nem relógio; todo efeito colateral
 * fica com quem aplicar o plano.
 *
 * Garantias:
 * - recurso só é marcado como removido se o seu escopo foi coletado;
 * - recurso removido que reaparece é reativado (a linha existente é
 *   reaproveitada, respeitando a unicidade da tabela) e registrado como "created";
 * - recursos de escopos não coletados não são tocados.
 */
export function planIngest(input: IngestInput): IngestPlan {
  const { previous, scan, now, newId } = input;

  const all = indexAll(previous);
  const active = previous.filter((r) => r.removedAt === null);
  const changes = computeChanges(active, scan.resources, scan.scannedScopes);

  const changedByKey = new Map<string, ResourceChange>();
  for (const c of changes) if (c.kind === 'changed') changedByKey.set(c.key, c);

  const inserts: StoredResource[] = [];
  const updates: PlannedUpdate[] = [];
  const touches: string[] = [];
  const removals: string[] = [];
  const planned: PlannedChange[] = [];
  let created = 0;
  let changed = 0;

  for (const cur of scan.resources) {
    const key = resourceKey(cur);
    const existing = all.get(key);

    if (!existing) {
      const id = newId();
      inserts.push({
        ...cur,
        id,
        configHash: contentHash(cur),
        firstSeenAt: now,
        lastSeenAt: now,
        removedAt: null,
      });
      planned.push({ resourceId: id, kind: 'created', diff: {}, occurredAt: now });
      created++;
    } else if (existing.removedAt !== null) {
      updates.push({ id: existing.id, patch: patchFor(cur, now) });
      planned.push({
        resourceId: existing.id,
        kind: 'created',
        diff: { reappeared: true },
        occurredAt: now,
      });
      created++;
    } else {
      const change = changedByKey.get(key);
      if (change) {
        updates.push({ id: existing.id, patch: patchFor(cur, now) });
        planned.push({
          resourceId: existing.id,
          kind: 'changed',
          diff: fieldDiff(change),
          occurredAt: now,
        });
        changed++;
      } else {
        touches.push(existing.id);
      }
    }
  }

  for (const c of changes) {
    if (c.kind !== 'removed') continue;
    const row = all.get(c.key);
    if (!row) throw new Error(`Recurso removido sem linha correspondente: ${c.key}`);
    removals.push(row.id);
    planned.push({ resourceId: row.id, kind: 'removed', diff: {}, occurredAt: now });
  }

  return {
    at: now,
    inserts,
    updates,
    touches,
    removals,
    changes: planned,
    summary: {
      status: scanStatus(scan),
      created,
      changed,
      removed: removals.length,
      errors: scan.errors,
    },
  };
}
