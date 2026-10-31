import type { NormalizedResource, ScanScope } from '@ds/core';
import {
  AWS_TYPES,
  normalizeBucket,
  normalizeDbInstance,
  normalizeElasticIp,
  normalizeInstance,
  normalizeLoadBalancer,
  normalizeVolume,
} from './normalize.ts';
import type {
  RawAddress,
  RawBucket,
  RawDbInstance,
  RawInstance,
  RawLoadBalancer,
  RawVolume,
} from './raw.ts';

/**
 * Fronteira com a AWS. A implementação real (AWS SDK v3, com paginação,
 * retentativas e credenciais temporárias de `sts:AssumeRole`) vem depois;
 * cada método devolve a lista COMPLETA, já paginada.
 */
export interface AwsApi {
  listInstances(region: string): Promise<RawInstance[]>;
  listVolumes(region: string): Promise<RawVolume[]>;
  listElasticIps(region: string): Promise<RawAddress[]>;
  listDbInstances(region: string): Promise<RawDbInstance[]>;
  listLoadBalancers(region: string): Promise<RawLoadBalancer[]>;
  /** S3 é global: uma chamada lista os buckets de todas as regiões. */
  listBuckets(): Promise<RawBucket[]>;
}

export interface ScanError {
  region: string;
  type: string;
  message: string;
}

export interface ScanResult {
  resources: NormalizedResource[];
  /** Somente o que foi listado e normalizado com sucesso. */
  scannedScopes: ScanScope[];
  errors: ScanError[];
}

export interface ScanOptions {
  accountId: string;
  regions: readonly string[];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Coleta o inventário de uma conta AWS.
 *
 * Cada combinação (região, tipo) é uma unidade independente: se ela falha
 * (permissão, limite de API, erro de normalização), nada dela é aproveitado
 * e o escopo NÃO é marcado como coletado. Assim `computeChanges` nunca
 * conclui que recursos daquela unidade foram removidos.
 */
export async function runAwsScan(api: AwsApi, opts: ScanOptions): Promise<ScanResult> {
  const resources: NormalizedResource[] = [];
  const scannedScopes: ScanScope[] = [];
  const errors: ScanError[] = [];

  async function unit(
    region: string,
    type: string,
    scopeRegion: string,
    run: () => Promise<NormalizedResource[]>,
  ): Promise<void> {
    try {
      const items = await run();
      resources.push(...items);
      scannedScopes.push({ provider: 'aws', accountId: opts.accountId, region: scopeRegion, type });
    } catch (e) {
      errors.push({ region, type, message: message(e) });
    }
  }

  for (const region of opts.regions) {
    const ctx = { accountId: opts.accountId, region };
    await unit(region, AWS_TYPES.instance, region, async () =>
      (await api.listInstances(region)).map((r) => normalizeInstance(r, ctx)),
    );
    await unit(region, AWS_TYPES.volume, region, async () =>
      (await api.listVolumes(region)).map((r) => normalizeVolume(r, ctx)),
    );
    await unit(region, AWS_TYPES.elasticIp, region, async () =>
      (await api.listElasticIps(region)).map((r) => normalizeElasticIp(r, ctx)),
    );
    await unit(region, AWS_TYPES.database, region, async () =>
      (await api.listDbInstances(region)).map((r) => normalizeDbInstance(r, ctx)),
    );
    await unit(region, AWS_TYPES.loadBalancer, region, async () =>
      (await api.listLoadBalancers(region)).map((r) => normalizeLoadBalancer(r, ctx)),
    );
  }

  await unit('*', AWS_TYPES.bucket, '*', async () =>
    (await api.listBuckets()).map((r) => normalizeBucket(r, { accountId: opts.accountId })),
  );

  return { resources, scannedScopes, errors };
}
