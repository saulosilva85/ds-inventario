import type { NormalizedResource, ResourceCategory } from '@ds/core';
import type { RawAsset } from './raw.ts';

export interface NormalizeContext {
  projectId: string;
}

export const GCP_TYPES = {
  instance: 'compute.googleapis.com/Instance',
  disk: 'compute.googleapis.com/Disk',
  address: 'compute.googleapis.com/Address',
  forwardingRule: 'compute.googleapis.com/ForwardingRule',
  sqlInstance: 'sqladmin.googleapis.com/Instance',
  bucket: 'storage.googleapis.com/Bucket',
} as const;

export const GCP_ASSET_TYPES: readonly string[] = Object.values(GCP_TYPES);

// ------------------------------------------------------------ utilitários
type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** A API do Google devolve inteiros grandes como string (ex.: sizeGb "20"). */
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function first(v: unknown): Obj {
  return Array.isArray(v) ? obj(v[0]) : {};
}

function labels(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj(v))) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

/** Último trecho de uma URL de recurso, ex.: .../machineTypes/e2-micro -> e2-micro */
export function lastSegment(url: unknown): string | null {
  const s = str(url);
  if (!s) return null;
  const last = s.split('/').pop();
  return last ? last : null;
}

/**
 * Converte a localização do asset em região: zona (southamerica-east1-a)
 * vira região (southamerica-east1); multi-região e "global" são mantidas.
 */
export function locationToRegion(location: string | null | undefined): string {
  const l = (location ?? '').trim().toLowerCase();
  if (!l) return 'global';
  const m = /^([a-z]+-[a-z]+\d+)-[a-z]$/.exec(l);
  return m?.[1] ?? l;
}

interface Base {
  provider: 'gcp';
  accountId: string;
  region: string;
  category: ResourceCategory;
  type: string;
  nativeId: string;
}

function base(
  raw: RawAsset,
  ctx: NormalizeContext,
  expectedType: string,
  category: ResourceCategory,
): Base {
  if (raw.assetType !== expectedType) {
    throw new Error(`Asset do tipo "${raw.assetType}" onde se esperava "${expectedType}"`);
  }
  if (!raw.name) throw new Error('Asset do GCP sem name');
  return {
    provider: 'gcp',
    accountId: ctx.projectId,
    region: locationToRegion(raw.resource?.location),
    category,
    type: expectedType,
    nativeId: raw.name,
  };
}

function data(raw: RawAsset): Obj {
  return obj(raw.resource?.data);
}

// ---------------------------------------------------------- normalizadores
export function normalizeInstance(raw: RawAsset, ctx: NormalizeContext): NormalizedResource {
  const d = data(raw);
  const nic = first(d['networkInterfaces']);
  return {
    ...base(raw, ctx, GCP_TYPES.instance, 'compute'),
    name: str(d['name']),
    state: str(d['status']),
    tags: labels(d['labels']),
    config: {
      machineType: lastSegment(d['machineType']),
      zone: lastSegment(d['zone']),
      privateIp: str(nic['networkIP']),
      publicIp: str(first(nic['accessConfigs'])['natIP']),
      cpuPlatform: str(d['cpuPlatform']),
      creationTimestamp: str(d['creationTimestamp']),
    },
  };
}

export function normalizeDisk(raw: RawAsset, ctx: NormalizeContext): NormalizedResource {
  const d = data(raw);
  const users = Array.isArray(d['users']) ? d['users'] : [];
  return {
    ...base(raw, ctx, GCP_TYPES.disk, 'storage'),
    name: str(d['name']),
    state: str(d['status']),
    tags: labels(d['labels']),
    config: {
      sizeGb: num(d['sizeGb']),
      diskType: lastSegment(d['type']),
      zone: lastSegment(d['zone']),
      attachedTo: users.map(lastSegment).filter((u): u is string => u !== null),
      creationTimestamp: str(d['creationTimestamp']),
    },
  };
}

export function normalizeAddress(raw: RawAsset, ctx: NormalizeContext): NormalizedResource {
  const d = data(raw);
  const users = Array.isArray(d['users']) ? d['users'] : [];
  return {
    ...base(raw, ctx, GCP_TYPES.address, 'network'),
    name: str(d['name']),
    state: str(d['status']),
    tags: labels(d['labels']),
    config: {
      address: str(d['address']),
      addressType: str(d['addressType']),
      users: users.map(lastSegment).filter((u): u is string => u !== null),
    },
  };
}

/** Balanceadores no GCP são representados pelas regras de encaminhamento. */
export function normalizeForwardingRule(raw: RawAsset, ctx: NormalizeContext): NormalizedResource {
  const d = data(raw);
  return {
    ...base(raw, ctx, GCP_TYPES.forwardingRule, 'network'),
    name: str(d['name']),
    state: null,
    tags: labels(d['labels']),
    config: {
      ipAddress: str(d['IPAddress']),
      protocol: str(d['IPProtocol']),
      scheme: str(d['loadBalancingScheme']),
      portRange: str(d['portRange']),
      target: lastSegment(d['target']),
    },
  };
}

export function normalizeSqlInstance(raw: RawAsset, ctx: NormalizeContext): NormalizedResource {
  const d = data(raw);
  const settings = obj(d['settings']);
  return {
    ...base(raw, ctx, GCP_TYPES.sqlInstance, 'database'),
    name: str(d['name']),
    state: str(d['state']),
    tags: labels(settings['userLabels']),
    config: {
      databaseVersion: str(d['databaseVersion']),
      instanceType: str(d['instanceType']),
      tier: str(settings['tier']),
      availabilityType: str(settings['availabilityType']),
      dataDiskSizeGb: num(settings['dataDiskSizeGb']),
      dataDiskType: str(settings['dataDiskType']),
    },
  };
}

export function normalizeBucket(raw: RawAsset, ctx: NormalizeContext): NormalizedResource {
  const d = data(raw);
  return {
    ...base(raw, ctx, GCP_TYPES.bucket, 'storage'),
    name: str(d['name']),
    state: null,
    tags: labels(d['labels']),
    config: {
      storageClass: str(d['storageClass']),
      location: str(d['location']),
      timeCreated: str(d['timeCreated']),
    },
  };
}

/** Escolhe o normalizador pelo `assetType`; tipos desconhecidos geram erro. */
export function normalizeAsset(raw: RawAsset, ctx: NormalizeContext): NormalizedResource {
  switch (raw.assetType) {
    case GCP_TYPES.instance:
      return normalizeInstance(raw, ctx);
    case GCP_TYPES.disk:
      return normalizeDisk(raw, ctx);
    case GCP_TYPES.address:
      return normalizeAddress(raw, ctx);
    case GCP_TYPES.forwardingRule:
      return normalizeForwardingRule(raw, ctx);
    case GCP_TYPES.sqlInstance:
      return normalizeSqlInstance(raw, ctx);
    case GCP_TYPES.bucket:
      return normalizeBucket(raw, ctx);
    default:
      throw new Error(`Tipo de asset não suportado: ${raw.assetType ?? '(vazio)'}`);
  }
}
