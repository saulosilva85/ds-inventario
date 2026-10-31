import { createHash } from 'node:crypto';

/**
 * Serialização JSON determinística: chaves de objeto ordenadas e
 * propriedades `undefined` ignoradas. Garante que a ordem das chaves
 * não gere falsas diferenças entre coletas.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Hash do conteúdo de um recurso (nome, estado, tags e configuração). */
export function contentHash(r: {
  name: string | null;
  state: string | null;
  tags: Record<string, string>;
  config: Record<string, unknown>;
}): string {
  return sha256(stableStringify({ name: r.name, state: r.state, tags: r.tags, config: r.config }));
}
