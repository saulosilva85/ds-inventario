import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeChanges, resourceKey } from './diff.ts';
import { contentHash, stableStringify } from './hash.ts';
import type { NormalizedResource, ScanScope } from './types.ts';

function vm(overrides: Partial<NormalizedResource> = {}): NormalizedResource {
  return {
    provider: 'aws',
    accountId: '111111111111',
    region: 'sa-east-1',
    category: 'compute',
    type: 'ec2:instance',
    nativeId: 'i-0001',
    name: 'web-1',
    state: 'running',
    tags: { env: 'prod' },
    config: { instanceType: 't3.micro' },
    ...overrides,
  };
}

const scope: ScanScope = {
  provider: 'aws',
  accountId: '111111111111',
  region: 'sa-east-1',
  type: 'ec2:instance',
};

test('stableStringify ignora a ordem das chaves', () => {
  assert.equal(stableStringify({ a: 1, b: { c: 2, d: 3 } }), stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
});

test('stableStringify mantém a ordem dos arrays e ignora undefined em objetos', () => {
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  assert.equal(stableStringify({ a: 1, b: undefined }), stableStringify({ a: 1 }));
});

test('contentHash é estável independente da ordem das chaves', () => {
  const a = vm({ config: { x: 1, y: 2 } });
  const b = vm({ config: { y: 2, x: 1 } });
  assert.equal(contentHash(a), contentHash(b));
  assert.notEqual(contentHash(a), contentHash(vm({ state: 'stopped' })));
});

test('sem diferenças: nenhuma mudança', () => {
  assert.deepEqual(computeChanges([vm()], [vm()], [scope]), []);
});

test('detecta recurso criado', () => {
  const changes = computeChanges([], [vm()], [scope]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.kind, 'created');
  assert.equal(changes[0]?.before, null);
});

test('detecta alteração e informa os campos alterados', () => {
  const after = vm({ state: 'stopped', tags: { env: 'prod', owner: 'ti' } });
  const changes = computeChanges([vm()], [after], [scope]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.kind, 'changed');
  assert.deepEqual(changes[0]?.changedFields, ['state', 'tags']);
});

test('detecta recurso removido quando o escopo foi coletado', () => {
  const changes = computeChanges([vm()], [], [scope]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.kind, 'removed');
  assert.equal(changes[0]?.key, resourceKey(vm()));
});

test('NÃO marca como removido se o escopo não foi coletado (falha parcial)', () => {
  const otherRegion: ScanScope = { ...scope, region: 'us-east-1' };
  assert.deepEqual(computeChanges([vm()], [], [otherRegion]), []);
  assert.deepEqual(computeChanges([vm()], [], []), []);
});

test('escopo com região "*" cobre todas as regiões', () => {
  const gcpVm = vm({ provider: 'gcp', accountId: 'meu-projeto', region: 'southamerica-east1', type: 'compute.googleapis.com/Instance' });
  const wildcard: ScanScope = { provider: 'gcp', accountId: 'meu-projeto', region: '*', type: 'compute.googleapis.com/Instance' };
  const changes = computeChanges([gcpVm], [], [wildcard]);
  assert.equal(changes[0]?.kind, 'removed');
});

test('recursos de contas diferentes com o mesmo ID nativo não se confundem', () => {
  const a = vm({ accountId: '111111111111' });
  const b = vm({ accountId: '222222222222' });
  assert.notEqual(resourceKey(a), resourceKey(b));
  const changes = computeChanges([a], [a, b], [scope, { ...scope, accountId: '222222222222' }]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.kind, 'created');
});

test('recurso duplicado na coleta gera erro explícito', () => {
  assert.throws(() => computeChanges([], [vm(), vm()], [scope]), /duplicado/);
});
