import type { NormalizedResource, Provider, ScanScope } from './types.ts';

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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Registra o resultado de uma coleta por "unidades" independentes.
 *
 * Regra de segurança compartilhada por todos os coletores: se a unidade
 * falha (permissão, limite de API, erro de normalização), NADA dela é
 * aproveitado e o escopo NÃO é marcado como coletado. Assim `computeChanges`
 * nunca conclui que recursos daquela unidade foram removidos.
 */
export function createScanRecorder(provider: Provider, accountId: string) {
  const resources: NormalizedResource[] = [];
  const scannedScopes: ScanScope[] = [];
  const errors: ScanError[] = [];

  return {
    /**
     * @param label região (ou "*") mostrada no erro
     * @param scopeRegion região registrada no escopo ("*" cobre todas)
     */
    async unit(
      label: string,
      type: string,
      scopeRegion: string,
      run: () => Promise<NormalizedResource[]>,
    ): Promise<void> {
      try {
        const items = await run();
        resources.push(...items);
        scannedScopes.push({ provider, accountId, region: scopeRegion, type });
      } catch (e) {
        errors.push({ region: label, type, message: message(e) });
      }
    },
    result(): ScanResult {
      return { resources, scannedScopes, errors };
    },
  };
}
