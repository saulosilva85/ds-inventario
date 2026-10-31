import { stableStringify } from './hash.ts';
import type {
  ContentField,
  NormalizedResource,
  ResourceChange,
  ScanScope,
} from './types.ts';

const CONTENT_FIELDS: readonly ContentField[] = ['name', 'state', 'tags', 'config'];

/** Chave estável e sem ambiguidade de um recurso. */
export function resourceKey(
  r: Pick<NormalizedResource, 'provider' | 'accountId' | 'region' | 'type' | 'nativeId'>,
): string {
  return JSON.stringify([r.provider, r.accountId, r.region, r.type, r.nativeId]);
}

export function scopeKey(s: ScanScope): string {
  return JSON.stringify([s.provider, s.accountId, s.region, s.type]);
}

function indexByKey(
  list: readonly NormalizedResource[],
  label: string,
): Map<string, NormalizedResource> {
  const map = new Map<string, NormalizedResource>();
  for (const r of list) {
    const key = resourceKey(r);
    if (map.has(key)) {
      throw new Error(`Recurso duplicado em "${label}": ${key}`);
    }
    map.set(key, r);
  }
  return map;
}

function changedFields(a: NormalizedResource, b: NormalizedResource): ContentField[] {
  return CONTENT_FIELDS.filter((f) => stableStringify(a[f]) !== stableStringify(b[f]));
}

/**
 * Compara o estado anterior (somente recursos ATIVOS) com a coleta atual.
 *
 * Regra de segurança: um recurso só é considerado "removido" se a sua
 * parte do ambiente (`ScanScope`) foi listada com sucesso nesta coleta.
 * Assim, uma falha parcial (erro numa região, limite de API) nunca
 * apaga recursos por engano.
 */
export function computeChanges(
  previous: readonly NormalizedResource[],
  current: readonly NormalizedResource[],
  scannedScopes: readonly ScanScope[],
): ResourceChange[] {
  const covered = new Set(scannedScopes.map(scopeKey));
  const isCovered = (r: NormalizedResource): boolean => {
    const base = { provider: r.provider, accountId: r.accountId, type: r.type };
    return (
      covered.has(scopeKey({ ...base, region: r.region })) ||
      covered.has(scopeKey({ ...base, region: '*' }))
    );
  };

  const prevMap = indexByKey(previous, 'anterior');
  const currMap = indexByKey(current, 'atual');
  const changes: ResourceChange[] = [];

  for (const [key, after] of currMap) {
    const before = prevMap.get(key);
    if (!before) {
      changes.push({ kind: 'created', key, before: null, after, changedFields: [] });
      continue;
    }
    const fields = changedFields(before, after);
    if (fields.length > 0) {
      changes.push({ kind: 'changed', key, before, after, changedFields: fields });
    }
  }

  for (const [key, before] of prevMap) {
    if (currMap.has(key) || !isCovered(before)) continue;
    changes.push({ kind: 'removed', key, before, after: null, changedFields: [] });
  }

  return changes;
}
