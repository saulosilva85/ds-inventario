import type { NormalizedResource } from '@ds/core';
import type {
  RawAddress,
  RawBucket,
  RawDbInstance,
  RawInstance,
  RawLoadBalancer,
  RawTag,
  RawVolume,
} from './raw.ts';

export interface NormalizeContext {
  accountId: string;
  region: string;
}

export const AWS_TYPES = {
  instance: 'ec2:instance',
  volume: 'ec2:volume',
  elasticIp: 'ec2:elastic-ip',
  database: 'rds:db-instance',
  bucket: 's3:bucket',
  loadBalancer: 'elbv2:load-balancer',
} as const;

export function tagsToRecord(tags: readonly RawTag[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags ?? []) {
    if (t.Key) out[t.Key] = t.Value ?? '';
  }
  return out;
}

function required(value: string | undefined, what: string): string {
  if (!value) throw new Error(`Resposta da AWS sem ${what}`);
  return value;
}

function nameTag(tags: Record<string, string>): string | null {
  return tags['Name'] || null;
}

export function normalizeInstance(raw: RawInstance, ctx: NormalizeContext): NormalizedResource {
  const tags = tagsToRecord(raw.Tags);
  return {
    provider: 'aws',
    accountId: ctx.accountId,
    region: ctx.region,
    category: 'compute',
    type: AWS_TYPES.instance,
    nativeId: required(raw.InstanceId, 'InstanceId'),
    name: nameTag(tags),
    state: raw.State?.Name ?? null,
    tags,
    config: {
      instanceType: raw.InstanceType ?? null,
      availabilityZone: raw.Placement?.AvailabilityZone ?? null,
      privateIp: raw.PrivateIpAddress ?? null,
      publicIp: raw.PublicIpAddress ?? null,
      imageId: raw.ImageId ?? null,
      vpcId: raw.VpcId ?? null,
      subnetId: raw.SubnetId ?? null,
      architecture: raw.Architecture ?? null,
      launchTime: raw.LaunchTime?.toISOString() ?? null,
    },
  };
}

export function normalizeVolume(raw: RawVolume, ctx: NormalizeContext): NormalizedResource {
  const tags = tagsToRecord(raw.Tags);
  return {
    provider: 'aws',
    accountId: ctx.accountId,
    region: ctx.region,
    category: 'storage',
    type: AWS_TYPES.volume,
    nativeId: required(raw.VolumeId, 'VolumeId'),
    name: nameTag(tags),
    state: raw.State ?? null,
    tags,
    config: {
      sizeGiB: raw.Size ?? null,
      volumeType: raw.VolumeType ?? null,
      iops: raw.Iops ?? null,
      encrypted: raw.Encrypted ?? null,
      availabilityZone: raw.AvailabilityZone ?? null,
      attachments: (raw.Attachments ?? []).map((a) => ({
        instanceId: a.InstanceId ?? null,
        device: a.Device ?? null,
      })),
    },
  };
}

export function normalizeElasticIp(raw: RawAddress, ctx: NormalizeContext): NormalizedResource {
  const tags = tagsToRecord(raw.Tags);
  return {
    provider: 'aws',
    accountId: ctx.accountId,
    region: ctx.region,
    category: 'network',
    type: AWS_TYPES.elasticIp,
    nativeId: required(raw.AllocationId, 'AllocationId'),
    name: nameTag(tags),
    state: raw.AssociationId ? 'associated' : 'unassociated',
    tags,
    config: {
      publicIp: raw.PublicIp ?? null,
      instanceId: raw.InstanceId ?? null,
      networkInterfaceId: raw.NetworkInterfaceId ?? null,
      domain: raw.Domain ?? null,
    },
  };
}

export function normalizeDbInstance(raw: RawDbInstance, ctx: NormalizeContext): NormalizedResource {
  const tags = tagsToRecord(raw.TagList);
  const id = required(raw.DBInstanceIdentifier, 'DBInstanceIdentifier');
  return {
    provider: 'aws',
    accountId: ctx.accountId,
    region: ctx.region,
    category: 'database',
    type: AWS_TYPES.database,
    nativeId: id,
    name: nameTag(tags) ?? id,
    state: raw.DBInstanceStatus ?? null,
    tags,
    config: {
      instanceClass: raw.DBInstanceClass ?? null,
      engine: raw.Engine ?? null,
      engineVersion: raw.EngineVersion ?? null,
      multiAz: raw.MultiAZ ?? null,
      storageType: raw.StorageType ?? null,
      allocatedStorageGiB: raw.AllocatedStorage ?? null,
      storageEncrypted: raw.StorageEncrypted ?? null,
    },
  };
}

export function normalizeLoadBalancer(
  raw: RawLoadBalancer,
  ctx: NormalizeContext,
): NormalizedResource {
  const tags = tagsToRecord(raw.Tags);
  return {
    provider: 'aws',
    accountId: ctx.accountId,
    region: ctx.region,
    category: 'network',
    type: AWS_TYPES.loadBalancer,
    nativeId: required(raw.LoadBalancerArn, 'LoadBalancerArn'),
    name: raw.LoadBalancerName ?? null,
    state: raw.State?.Code ?? null,
    tags,
    config: {
      type: raw.Type ?? null,
      scheme: raw.Scheme ?? null,
      dnsName: raw.DNSName ?? null,
      vpcId: raw.VpcId ?? null,
    },
  };
}

/** Bucket: a região vem do próprio bucket, não da região da coleta. */
export function normalizeBucket(
  raw: RawBucket,
  ctx: Pick<NormalizeContext, 'accountId'>,
): NormalizedResource {
  const tags = tagsToRecord(raw.Tags);
  const name = required(raw.Name, 'Name do bucket');
  return {
    provider: 'aws',
    accountId: ctx.accountId,
    region: required(raw.Region, 'região do bucket'),
    category: 'storage',
    type: AWS_TYPES.bucket,
    nativeId: name,
    name,
    state: null,
    tags,
    config: {
      creationDate: raw.CreationDate?.toISOString() ?? null,
    },
  };
}
