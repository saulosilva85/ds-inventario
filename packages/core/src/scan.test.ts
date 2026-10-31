import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScanRecorder } from './scan.ts';
import type { NormalizedResource } from './types.ts';

function res(id: string): NormalizedResource {
  return {
    provider: 'aws',
    accountId: '1',
    region: 'r',
    category: 'compute',
    type: 't',
    nativeId: id,
    name: null,
    state: null,
    tags: {},
    config: {},
  };
}

test('unidade com sucesso guarda recursos e escopo', async () => {
  const rec = createScanRecorder('aws', '1');
  await rec.unit('r', 't', 'r', async () => [res('a'), res('b')]);
  const out = rec.result();
  assert.equal(out.resources.length, 2);
  assert.deepEqual(out.scannedScopes, [{ provider: 'aws', accountId: '1', region: 'r', type: 't' }]);
  assert.equal(out.errors.length, 0);
});

test('unidade com falha não guarda recursos nem escopo e registra o erro', async () => {
  const rec = createScanRecorder('aws', '1');
  await rec.unit('r', 't', 'r', async () => {
    throw new Error('Throttling');
  });
  const out = rec.result();
  assert.equal(out.resources.length, 0);
  assert.equal(out.scannedScopes.length, 0);
  assert.deepEqual(out.errors, [{ region: 'r', type: 't', message: 'Throttling' }]);
});

test('uma unidade com falha não afeta as outras', async () => {
  const rec = createScanRecorder('gcp', 'p');
  await rec.unit('*', 'a', '*', async () => {
    throw 'texto solto';
  });
  await rec.unit('*', 'b', '*', async () => [res('x')]);
  const out = rec.result();
  assert.equal(out.errors[0]?.message, 'texto solto');
  assert.equal(out.scannedScopes.length, 1);
  assert.equal(out.scannedScopes[0]?.provider, 'gcp');
});
