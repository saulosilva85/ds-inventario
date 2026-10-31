import { createScanRecorder, type ScanResult } from '@ds/core';
import { GCP_ASSET_TYPES, normalizeAsset } from './normalize.ts';
import type { RawAsset } from './raw.ts';

/**
 * Fronteira com a Cloud Asset Inventory API. A implementação real
 * (autenticação pela nossa conta de serviço, paginação com `pageToken`,
 * retentativas) vem depois; devolve a lista COMPLETA do tipo no projeto.
 */
export interface GcpApi {
  listAssets(projectId: string, assetType: string): Promise<RawAsset[]>;
}

export interface GcpScanOptions {
  projectId: string;
  /** Padrão: todos os tipos suportados na v1. */
  assetTypes?: readonly string[] | undefined;
}

/**
 * Coleta o inventário de um projeto GCP. Cada tipo de asset é uma unidade
 * que cobre todas as localizações (`region: '*'`), pois uma única chamada
 * lista o tipo em todas as regiões.
 */
export async function runGcpScan(api: GcpApi, opts: GcpScanOptions): Promise<ScanResult> {
  const rec = createScanRecorder('gcp', opts.projectId);
  for (const type of opts.assetTypes ?? GCP_ASSET_TYPES) {
    await rec.unit('*', type, '*', async () =>
      (await api.listAssets(opts.projectId, type)).map((a) =>
        normalizeAsset(a, { projectId: opts.projectId }),
      ),
    );
  }
  return rec.result();
}
