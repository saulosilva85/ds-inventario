export type PlanCode = 'inicial' | 'profissional' | 'empresarial';
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/** `null` = sem limite fixo (negociado). */
export interface PlanLimits {
  connections: number | null;
  resources: number | null;
  users: number | null;
  /** Intervalo mínimo entre coletas, em horas. */
  scanIntervalHours: number;
  /** Retenção do histórico, em dias. */
  historyDays: number | null;
  exports: readonly ExportFormat[];
  scheduledReports: boolean;
}

/**
 * VALORES PROPOSTOS (documento da fase 0, seção 8; decisão aberta nº 3).
 * Ajustar aqui é a única mudança necessária quando a tabela final for definida.
 */
export const PLANS: Readonly<Record<PlanCode, PlanLimits>> = {
  inicial: {
    connections: 1,
    resources: 200,
    users: 2,
    scanIntervalHours: 24,
    historyDays: 30,
    exports: ['csv'],
    scheduledReports: false,
  },
  profissional: {
    connections: 5,
    resources: 2000,
    users: 10,
    scanIntervalHours: 6,
    historyDays: 365,
    exports: ['csv', 'xlsx', 'pdf'],
    scheduledReports: true,
  },
  empresarial: {
    connections: null,
    resources: null,
    users: null,
    scanIntervalHours: 1,
    historyDays: 730, // marcador: "estendido", a definir por contrato
    exports: ['csv', 'xlsx', 'pdf'],
    scheduledReports: true,
  },
};

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && Object.hasOwn(PLANS, value);
}

export type Decision = { allowed: true } | { allowed: false; reason: string };

function underLimit(limit: number | null, current: number, noun: string): Decision {
  if (limit === null || current < limit) return { allowed: true };
  return { allowed: false, reason: `Limite do plano atingido: até ${limit} ${noun}.` };
}

export function canAddConnection(plan: PlanCode, currentConnections: number): Decision {
  return underLimit(PLANS[plan].connections, currentConnections, 'conexões de nuvem');
}

export function canAddUser(plan: PlanCode, currentUsers: number): Decision {
  return underLimit(PLANS[plan].users, currentUsers, 'usuários');
}

export function canExport(plan: PlanCode, format: ExportFormat): Decision {
  if (PLANS[plan].exports.includes(format)) return { allowed: true };
  return { allowed: false, reason: `O plano atual não inclui exportação em ${format.toUpperCase()}.` };
}

export function canScheduleReports(plan: PlanCode): Decision {
  if (PLANS[plan].scheduledReports) return { allowed: true };
  return { allowed: false, reason: 'O plano atual não inclui relatórios agendados.' };
}

export type UsageStatus = 'ok' | 'near' | 'exceeded';

export interface ResourceUsage {
  status: UsageStatus;
  used: number;
  limit: number | null;
  /** Quantos recursos passam do limite (0 se não excedeu). */
  overBy: number;
}

/**
 * Consumo de recursos inventariados. "near" a partir de 90% do limite.
 * A política para "exceeded" (avisar, bloquear coleta nova etc.) fica com
 * quem chama: esta função só mede.
 */
export function evaluateResourceUsage(plan: PlanCode, activeResources: number): ResourceUsage {
  const limit = PLANS[plan].resources;
  if (limit === null) return { status: 'ok', used: activeResources, limit, overBy: 0 };
  if (activeResources > limit) {
    return { status: 'exceeded', used: activeResources, limit, overBy: activeResources - limit };
  }
  const status: UsageStatus = activeResources >= limit * 0.9 ? 'near' : 'ok';
  return { status, used: activeResources, limit, overBy: 0 };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A conexão está "vencida" para uma nova coleta automática? */
export function isScanDue(plan: PlanCode, lastScanAt: Date | null, now: Date): boolean {
  if (lastScanAt === null) return true;
  return now.getTime() - lastScanAt.getTime() >= PLANS[plan].scanIntervalHours * HOUR_MS;
}

/** Eventos de histórico anteriores a esta data podem ser apagados. `null` = reter tudo. */
export function historyCutoff(plan: PlanCode, now: Date): Date | null {
  const days = PLANS[plan].historyDays;
  return days === null ? null : new Date(now.getTime() - days * DAY_MS);
}
