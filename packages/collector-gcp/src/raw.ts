/**
 * Formato de um asset da Cloud Asset Inventory API (`assets.list` com
 * `contentType=RESOURCE`). O conteúdo de `resource.data` varia por tipo e é
 * tratado como dado não confiável: os normalizadores validam cada campo.
 */
export interface RawAsset {
  /** Nome completo, ex.: //compute.googleapis.com/projects/p/zones/z/instances/123 */
  name?: string | undefined;
  assetType?: string | undefined;
  updateTime?: string | undefined;
  resource?:
    | {
        /** Região, zona ou "global". */
        location?: string | undefined;
        data?: Record<string, unknown> | undefined;
      }
    | undefined;
}
