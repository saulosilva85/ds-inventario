import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeChanges } from '@ds/core';
import {
  GCP_TYPES,
  locationToRegion,
  lastSegment,
  normalizeAddress,
  normalizeAsset,
  normalizeBucket,
  normalizeDisk,
  normalizeForwardingRule,
  normalizeInstance,
  normalizeSqlInstance,
} from './normalize.ts';
import type { RawAsset } from './raw.ts';
import { runGcpScan, type GcpApi } from './scan.ts';

const ctx = { projectId: 'meu-projeto' };
const P = '//compute.googleapis.com/projects/meu-projeto';

const instance: RawAsset = {
  name: `${P}/zones/southamerica-east1-a/instances/123`,
  assetType: GCP_TYPES.instance,
  resource: {
    location: 'southamerica-east1-a',
    data: {
      name: 'web-1',
      status: 'RUNNING',
      machineType: 'https://www.googleapis.com/compute/v1/projects/meu-projeto/zones/southamerica-east1-a/machineTypes/e2-micro',
      zone: 'https://www.googleapis.com/compute/v1/projects/meu-projeto/zones/southamerica-east1-a',
      labels: { env: 'prod', numero: 5 },
      networkInterfaces: [{ networkIP: '10.0.0.5', accessConfigs: [{ natIP: '35.1.2.3' }] }],
      creationTimestamp: '2026-10-01T09:00:00.000-03:00',
    },
  },
};

test('locationToRegion converte zona em região e preserva o resto', () => {
  assert.equal(locationToRegion('southamerica-east1-a'), 'southamerica-east1');
  assert.equal(locationToRegion('us-central1'), 'us-central1');
  assert.equal(locationToRegion('US'), 'us');
  assert.equal(locationToRegion('global'), 'global');
  assert.equal(locationToRegion(undefined), 'global');
  assert.equal(locationToRegion('  '), 'global');
});

test('lastSegment extrai o fim da URL', () => {
  assert.equal(lastSegment('https://x/y/machineTypes/e2-micro'), 'e2-micro');
  assert.equal(lastSegment(undefined), null);
  assert.equal(lastSegment(''), null);
});

test('normalizeInstance extrai campos e ignora labels que não são texto', () => {
  const r = normalizeInstance(instance, ctx);
  assert.equal(r.provider, 'gcp');
  assert.equal(r.accountId, 'meu-projeto');
  assert.equal(r.region, 'southamerica-east1');
  assert.equal(r.nativeId, instance.name);
  assert.equal(r.name, 'web-1');
  assert.equal(r.state, 'RUNNING');
  assert.deepEqual(r.tags, { env: 'prod' });
  assert.equal(r.config['machineType'], 'e2-micro');
  assert.equal(r.config['zone'], 'southamerica-east1-a');
  assert.equal(r.config['privateIp'], '10.0.0.5');
  assert.equal(r.config['publicIp'], '35.1.2.3');
});

test('normalizeInstance tolera dados ausentes sem quebrar', () => {
  const r = normalizeInstance({ name: 'n', assetType: GCP_TYPES.instance }, ctx);
  assert.equal(r.region, 'global');
  assert.equal(r.name, null);
  assert.equal(r.config['publicIp'], null);
});

test('normalizeDisk converte sizeGb de texto para número e lista anexos', () => {
  const r = normalizeDisk(
    {
      name: `${P}/zones/z/disks/9`,
      assetType: GCP_TYPES.disk,
      resource: { location: 'us-central1-b', data: { name: 'disco', sizeGb: '20', status: 'READY', users: ['https://x/instances/web-1'], type: 'https://x/diskTypes/pd-balanced' } },
    },
    ctx,
  );
  assert.equal(r.category, 'storage');
  assert.equal(r.config['sizeGb'], 20);
  assert.deepEqual(r.config['attachedTo'], ['web-1']);
  assert.equal(r.config['diskType'], 'pd-balanced');
});

test('normalizeAddress, forwarding rule, Cloud SQL e bucket', () => {
  const a = normalizeAddress({ name: `${P}/regions/r/addresses/1`, assetType: GCP_TYPES.address, resource: { location: 'us-central1', data: { name: 'ip-1', address: '34.0.0.1', addressType: 'EXTERNAL', status: 'IN_USE' } } }, ctx);
  assert.equal(a.category, 'network');
  assert.equal(a.state, 'IN_USE');

  const f = normalizeForwardingRule({ name: `${P}/global/forwardingRules/1`, assetType: GCP_TYPES.forwardingRule, resource: { location: 'global', data: { name: 'lb-1', IPAddress: '34.0.0.2', IPProtocol: 'TCP', loadBalancingScheme: 'EXTERNAL_MANAGED', target: 'https://x/targetHttpProxies/p1' } } }, ctx);
  assert.equal(f.config['target'], 'p1');
  assert.equal(f.state, null);

  const s = normalizeSqlInstance({ name: '//sqladmin.googleapis.com/projects/meu-projeto/instances/db', assetType: GCP_TYPES.sqlInstance, resource: { location: 'southamerica-east1', data: { name: 'db', state: 'RUNNABLE', databaseVersion: 'POSTGRES_15', settings: { tier: 'db-f1-micro', dataDiskSizeGb: '10', userLabels: { app: 'x' } } } } }, ctx);
  assert.equal(s.category, 'database');
  assert.equal(s.config['dataDiskSizeGb'], 10);
  assert.deepEqual(s.tags, { app: 'x' });

  const b = normalizeBucket({ name: '//storage.googleapis.com/meu-bucket', assetType: GCP_TYPES.bucket, resource: { location: 'SOUTHAMERICA-EAST1', data: { name: 'meu-bucket', storageClass: 'STANDARD' } } }, ctx);
  assert.equal(b.region, 'southamerica-east1');
  assert.equal(b.name, 'meu-bucket');
});

test('normalizeAsset rejeita tipo desconhecido e tipo divergente', () => {
  assert.throws(() => normalizeAsset({ name: 'x', assetType: 'outro.googleapis.com/Coisa' }, ctx), /não suportado/);
  assert.throws(() => normalizeDisk(instance, ctx), /esperava/);
  assert.throws(() => normalizeInstance({ assetType: GCP_TYPES.instance }, ctx), /sem name/);
});

function fakeApi(overrides: Partial<Record<string, () => Promise<RawAsset[]>>> = {}): GcpApi {
  return {
    listAssets: async (_project, type) => {
      const custom = overrides[type];
      if (custom) return custom();
      return type === GCP_TYPES.instance ? [instance] : [];
    },
  };
}

test('runGcpScan percorre todos os tipos com escopo "*"', async () => {
  const res = await runGcpScan(fakeApi(), { projectId: 'meu-projeto' });
  assert.equal(res.errors.length, 0);
  assert.equal(res.resources.length, 1);
  assert.equal(res.scannedScopes.length, 6);
  assert.ok(res.scannedScopes.every((s) => s.region === '*' && s.provider === 'gcp'));
});

test('falha num tipo não afeta os outros nem marca o escopo', async () => {
  const api = fakeApi({
    [GCP_TYPES.disk]: async () => {
      throw new Error('PERMISSION_DENIED');
    },
  });
  const res = await runGcpScan(api, { projectId: 'meu-projeto' });
  assert.deepEqual(res.errors, [{ region: '*', type: GCP_TYPES.disk, message: 'PERMISSION_DENIED' }]);
  assert.ok(!res.scannedScopes.some((s) => s.type === GCP_TYPES.disk));
  assert.equal(res.scannedScopes.length, 5);
});

test('assetTypes restringe a coleta', async () => {
  const res = await runGcpScan(fakeApi(), { projectId: 'meu-projeto', assetTypes: [GCP_TYPES.instance] });
  assert.equal(res.scannedScopes.length, 1);
});

test('integração com o core: remoção real vs. falha de listagem', async () => {
  const first = await runGcpScan(fakeApi(), { projectId: 'meu-projeto' });

  // 1) listagem OK e vazia: a instância foi removida de fato
  const empty = await runGcpScan(fakeApi({ [GCP_TYPES.instance]: async () => [] }), { projectId: 'meu-projeto' });
  const removed = computeChanges(first.resources, empty.resources, empty.scannedScopes);
  assert.deepEqual(removed.map((c) => c.kind), ['removed']);

  // 2) listagem falhou: nada pode ser considerado removido
  const failing = await runGcpScan(
    fakeApi({
      [GCP_TYPES.instance]: async () => {
        throw new Error('UNAVAILABLE');
      },
    }),
    { projectId: 'meu-projeto' },
  );
  assert.deepEqual(computeChanges(first.resources, failing.resources, failing.scannedScopes), []);
});
