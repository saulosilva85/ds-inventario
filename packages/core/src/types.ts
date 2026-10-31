/** Provedores de nuvem suportados na v1. */
export type Provider = 'aws' | 'gcp';

export type ResourceCategory = 'compute' | 'storage' | 'database' | 'network';

/**
 * Recurso no esquema comum entre AWS e GCP.
 * Detalhes específicos de cada provedor ficam em `config`.
 */
export interface NormalizedResource {
  provider: Provider;
  /** ID da conta AWS ou do projeto GCP. */
  accountId: string;
  /** Região; use "global" para recursos sem região. */
  region: string;
  category: ResourceCategory;
  /** Tipo nativo, ex.: "ec2:instance" ou "compute.googleapis.com/Instance". */
  type: string;
  nativeId: string;
  name: string | null;
  state: string | null;
  tags: Record<string, string>;
  config: Record<string, unknown>;
}

/**
 * Parte do ambiente que foi listada COM SUCESSO numa coleta.
 * `region: '*'` cobre todas as regiões (ex.: Cloud Asset API do GCP).
 */
export interface ScanScope {
  provider: Provider;
  accountId: string;
  region: string;
  type: string;
}

export type ChangeKind = 'created' | 'changed' | 'removed';

/** Campos de conteúdo comparados para detectar alteração. */
export type ContentField = 'name' | 'state' | 'tags' | 'config';

export interface ResourceChange {
  kind: ChangeKind;
  /** Chave estável do recurso (ver `resourceKey`). */
  key: string;
  before: NormalizedResource | null;
  after: NormalizedResource | null;
  /** Preenchido apenas quando `kind === 'changed'`. */
  changedFields: ContentField[];
}
