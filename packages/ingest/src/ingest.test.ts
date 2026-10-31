import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentHash, type NormalizedResource, type ScanResult, type ScanScope } from '@ds/core';
import { planIngest, scanStatus } from './ingest.ts';
import type { StoredResource } from './types.ts';

const T1 = '2026-11-01T10:00:00.000Z';
const T2 = '2026-11-01T16:00:00.000Z';

function vm(id: string, overrides: Partial<NormalizedResource> = {}): NormalizedResource {
  return {
    provider: 'aws',
    accountId: '111111111111',
    region: 'sa-east-1',
    category: 'compute',
    type: 'ec2:instance',
    nativeId: id,
    name: id,
    state: 'running',
    tags: {},
    config: { instanceType: 't3.micro' },
    ...overrides,
  };
}

const scope: ScanScope = { provider: 'aws', accountId: '111111111111', region: 'sa-east-1', type: 'ec2:instance' };

function scan(resources: NormalizedResource[], scopes: ScanScope[] = [scope], errors: ScanResult['errors'] = []): ScanResult {
  return { resources, scannedScopes: scopes, errors };
}

function stored(r: NormalizedResource, id: string, removedAt: string | null = null): StoredResource {
  return { ...r, id, configHash: contentHash(r), firstSeenAt: T1, lastSeenAt: T1, removedAt };
}

function idGen(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

test('primeira coleta: tudo vira insert e evento "created"', () => {
  const plan = planIngest({ previous: [], scan: scan([vm('a'), vm('b')]), now: T1, newId: idGen() });
  assert.equal(plan.inserts.length, 2);
  assert.deepEqual(plan.inserts.map((r) => r.id), ['new-1', 'new-2']);
  assert.equal(plan.inserts[0]?.firstSeenAt, T1);
  assert.equal(plan.inserts[0]?.configHash, contentHash(vm('a')));
  assert.deepEqual(plan.changes.map((c) => c.kind), ['created', 'created']);
  assert.deepEqual(plan.summary, { status: 'succeeded', created: 2, changed: 0, removed: 0, errors: [] });
});

test('sem mudanças: só "touches", nenhum evento de histórico', () => {
  const plan = planIngest({ previous: [stored(vm('a'), 'id-a')], scan: scan([vm('a')]), now: T2, newId: idGen() });
  assert.deepEqual(plan.touches, ['id-a']);
  assert.equal(plan.inserts.length + plan.updates.length + plan.removals.length, 0);
  assert.equal(plan.changes.length, 0);
});

test('alteração: update com novo hash e diff por campo', () => {
  const after = vm('a', { state: 'stopped', tags: { env: 'prod' } });
  const plan = planIngest({ previous: [stored(vm('a'), 'id-a')], scan: scan([after]), now: T2, newId: idGen() });
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0]?.id, 'id-a');
  assert.equal(plan.updates[0]?.patch.configHash, contentHash(after));
  assert.equal(plan.updates[0]?.patch.lastSeenAt, T2);
  assert.equal(plan.touches.length, 0);
  assert.deepEqual(plan.changes[0]?.diff, {
    state: { before: 'running', after: 'stopped' },
    tags: { before: {}, after: { env: 'prod' } },
  });
  assert.equal(plan.summary.changed, 1);
});

test('remoção no escopo coletado: removals + evento "removed"', () => {
  const plan = planIngest({ previous: [stored(vm('a'), 'id-a')], scan: scan([]), now: T2, newId: idGen() });
  assert.deepEqual(plan.removals, ['id-a']);
  assert.equal(plan.changes[0]?.kind, 'removed');
  assert.equal(plan.summary.removed, 1);
  assert.equal(plan.at, T2);
});

test('falha total: nada é removido nem tocado e o status é "failed"', () => {
  const errors = [{ region: 'sa-east-1', type: 'ec2:instance', message: 'Throttling' }];
  const plan = planIngest({ previous: [stored(vm('a'), 'id-a')], scan: scan([], [], errors), now: T2, newId: idGen() });
  assert.equal(plan.removals.length, 0);
  assert.equal(plan.touches.length, 0);
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.summary.status, 'failed');
  assert.deepEqual(plan.summary.errors, errors);
});

test('falha parcial: o que foi coletado é aplicado, o que falhou fica intacto', () => {
  const volScope: ScanScope = { ...scope, type: 'ec2:volume' };
  const vol = stored(vm('vol-1', { type: 'ec2:volume', category: 'storage' }), 'id-vol');
  const errors = [{ region: 'sa-east-1', type: 'ec2:instance', message: 'AccessDenied' }];
  // instâncias falharam (sem escopo); volumes foram coletados e o volume sumiu
  const plan = planIngest({
    previous: [stored(vm('a'), 'id-a'), vol],
    scan: scan([], [volScope], errors),
    now: T2,
    newId: idGen(),
  });
  assert.deepEqual(plan.removals, ['id-vol']);
  assert.equal(plan.touches.length, 0);
  assert.equal(plan.summary.status, 'partial');
  assert.equal(plan.summary.removed, 1);
});

test('status: partial quando parte foi coletada, failed quando nada foi', () => {
  const err = [{ region: 'x', type: 't', message: 'm' }];
  assert.equal(scanStatus(scan([], [scope], [])), 'succeeded');
  assert.equal(scanStatus(scan([], [scope], err)), 'partial');
  assert.equal(scanStatus(scan([], [], err)), 'failed');
});

test('recurso removido que reaparece é reativado, sem novo insert', () => {
  const gone = stored(vm('a'), 'id-a', T1);
  const plan = planIngest({ previous: [gone], scan: scan([vm('a')]), now: T2, newId: idGen() });
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0]?.id, 'id-a');
  assert.equal(plan.updates[0]?.patch.removedAt, null);
  assert.deepEqual(plan.changes[0], { resourceId: 'id-a', kind: 'created', diff: { reappeared: true }, occurredAt: T2 });
  assert.equal(plan.summary.created, 1);
});

test('recurso já removido e ainda ausente não gera nada', () => {
  const gone = stored(vm('a'), 'id-a', T1);
  const plan = planIngest({ previous: [gone], scan: scan([]), now: T2, newId: idGen() });
  assert.equal(plan.removals.length, 0);
  assert.equal(plan.changes.length, 0);
});

test('recursos fora dos escopos coletados não são tocados', () => {
  const other = stored(vm('b', { region: 'us-east-1' }), 'id-b');
  const plan = planIngest({ previous: [stored(vm('a'), 'id-a'), other], scan: scan([vm('a')]), now: T2, newId: idGen() });
  assert.deepEqual(plan.touches, ['id-a']);
  assert.equal(plan.removals.length, 0);
});

test('estado anterior com linhas duplicadas gera erro explícito', () => {
  const dup = [stored(vm('a'), 'id-1'), stored(vm('a'), 'id-2')];
  assert.throws(() => planIngest({ previous: dup, scan: scan([]), now: T2, newId: idGen() }), /duplicada/);
});

test('cenário misto numa só coleta', () => {
  const previous = [stored(vm('keep'), 'id-keep'), stored(vm('mod'), 'id-mod'), stored(vm('del'), 'id-del')];
  const current = [vm('keep'), vm('mod', { state: 'stopped' }), vm('novo')];
  const plan = planIngest({ previous, scan: scan(current), now: T2, newId: idGen() });
  assert.deepEqual(plan.touches, ['id-keep']);
  assert.deepEqual(plan.updates.map((u) => u.id), ['id-mod']);
  assert.deepEqual(plan.removals, ['id-del']);
  assert.deepEqual(plan.inserts.map((r) => r.nativeId), ['novo']);
  assert.deepEqual(plan.summary, { status: 'succeeded', created: 1, changed: 1, removed: 1, errors: [] });
});
