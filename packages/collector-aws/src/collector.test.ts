import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeChanges } from '@ds/core';
import {
  normalizeBucket,
  normalizeDbInstance,
  normalizeElasticIp,
  normalizeInstance,
  normalizeLoadBalancer,
  normalizeVolume,
  tagsToRecord,
} from './normalize.ts';
import { runAwsScan, type AwsApi } from './scan.ts';

const ctx = { accountId: '111111111111', region: 'sa-east-1' };

const instance = {
  InstanceId: 'i-0abc',
  InstanceType: 't3.micro',
  State: { Name: 'running' },
  Placement: { AvailabilityZone: 'sa-east-1a' },
  PrivateIpAddress: '10.0.0.10',
  Tags: [{ Key: 'Name', Value: 'web-1' }, { Key: 'env', Value: 'prod' }],
  LaunchTime: new Date('2026-10-01T12:00:00Z'),
};

test('tagsToRecord ignora tags sem chave e troca valor ausente por vazio', () => {
  assert.deepEqual(tagsToRecord([{ Key: 'a', Value: '1' }, { Value: 'x' }, { Key: 'b' }]), { a: '1', b: '' });
  assert.deepEqual(tagsToRecord(undefined), {});
});

test('normalizeInstance usa a tag Name e converte a data para ISO', () => {
  const r = normalizeInstance(instance, ctx);
  assert.equal(r.name, 'web-1');
  assert.equal(r.state, 'running');
  assert.equal(r.category, 'compute');
  assert.equal(r.type, 'ec2:instance');
  assert.equal(r.config['launchTime'], '2026-10-01T12:00:00.000Z');
  assert.equal(r.config['publicIp'], null);
});

test('normalizeInstance sem InstanceId falha de forma explícita', () => {
  assert.throws(() => normalizeInstance({}, ctx), /InstanceId/);
});

test('normalizeVolume inclui os anexos', () => {
  const r = normalizeVolume(
    { VolumeId: 'vol-1', Size: 20, State: 'in-use', Attachments: [{ InstanceId: 'i-0abc', Device: '/dev/xvda' }] },
    ctx,
  );
  assert.equal(r.category, 'storage');
  assert.deepEqual(r.config['attachments'], [{ instanceId: 'i-0abc', device: '/dev/xvda' }]);
});

test('normalizeElasticIp deriva o estado da associação', () => {
  assert.equal(normalizeElasticIp({ AllocationId: 'eipalloc-1', AssociationId: 'eipassoc-1' }, ctx).state, 'associated');
  assert.equal(normalizeElasticIp({ AllocationId: 'eipalloc-2' }, ctx).state, 'unassociated');
});

test('normalizeDbInstance usa o identificador como nome quando não há tag Name', () => {
  const r = normalizeDbInstance({ DBInstanceIdentifier: 'db-prod', Engine: 'postgres', DBInstanceStatus: 'available' }, ctx);
  assert.equal(r.name, 'db-prod');
  assert.equal(r.category, 'database');
});

test('normalizeLoadBalancer usa o ARN como ID nativo', () => {
  const arn = 'arn:aws:elasticloadbalancing:sa-east-1:111111111111:loadbalancer/app/x/1';
  const r = normalizeLoadBalancer({ LoadBalancerArn: arn, LoadBalancerName: 'x', State: { Code: 'active' } }, ctx);
  assert.equal(r.nativeId, arn);
  assert.equal(r.state, 'active');
});

test('normalizeBucket usa a região do próprio bucket', () => {
  const r = normalizeBucket({ Name: 'meu-bucket', Region: 'us-east-1' }, { accountId: '111111111111' });
  assert.equal(r.region, 'us-east-1');
  assert.equal(r.nativeId, 'meu-bucket');
  assert.throws(() => normalizeBucket({ Name: 'sem-regiao' }, { accountId: '1' }), /região/);
});

function fakeApi(overrides: Partial<AwsApi> = {}): AwsApi {
  return {
    listInstances: async () => [instance],
    listVolumes: async () => [{ VolumeId: 'vol-1', Size: 20, State: 'in-use' }],
    listElasticIps: async () => [],
    listDbInstances: async () => [],
    listLoadBalancers: async () => [],
    listBuckets: async () => [{ Name: 'meu-bucket', Region: 'sa-east-1' }],
    ...overrides,
  };
}

test('runAwsScan coleta tudo e registra os escopos, incluindo S3 global', async () => {
  const res = await runAwsScan(fakeApi(), { accountId: '111111111111', regions: ['sa-east-1'] });
  assert.equal(res.errors.length, 0);
  assert.equal(res.resources.length, 3);
  assert.equal(res.scannedScopes.length, 6);
  assert.ok(res.scannedScopes.some((s) => s.type === 's3:bucket' && s.region === '*'));
});

test('falha numa região não impede as demais e não marca o escopo como coletado', async () => {
  const api = fakeApi({
    listInstances: async (region) => {
      if (region === 'us-east-1') throw new Error('UnauthorizedOperation');
      return [instance];
    },
  });
  const res = await runAwsScan(api, { accountId: '111111111111', regions: ['sa-east-1', 'us-east-1'] });
  assert.deepEqual(res.errors, [{ region: 'us-east-1', type: 'ec2:instance', message: 'UnauthorizedOperation' }]);
  assert.ok(!res.scannedScopes.some((s) => s.region === 'us-east-1' && s.type === 'ec2:instance'));
  assert.ok(res.scannedScopes.some((s) => s.region === 'us-east-1' && s.type === 'ec2:volume'));
  assert.equal(res.resources.filter((r) => r.type === 'ec2:instance').length, 1);
});

test('erro de normalização descarta a unidade inteira (sem resultados parciais)', async () => {
  const api = fakeApi({ listInstances: async () => [instance, {}] });
  const res = await runAwsScan(api, { accountId: '111111111111', regions: ['sa-east-1'] });
  assert.equal(res.errors.length, 1);
  assert.equal(res.resources.filter((r) => r.type === 'ec2:instance').length, 0);
  assert.ok(!res.scannedScopes.some((s) => s.type === 'ec2:instance'));
});

test('integração com o core: falha parcial nunca gera "removido"', async () => {
  const first = await runAwsScan(fakeApi(), { accountId: '111111111111', regions: ['sa-east-1'] });
  const failing = fakeApi({
    listInstances: async () => {
      throw new Error('Throttling');
    },
    listVolumes: async () => [],
  });
  const second = await runAwsScan(failing, { accountId: '111111111111', regions: ['sa-east-1'] });
  const changes = computeChanges(first.resources, second.resources, second.scannedScopes);
  const removed = changes.filter((c) => c.kind === 'removed').map((c) => c.before?.type);
  assert.deepEqual(removed, ['ec2:volume']);
});
