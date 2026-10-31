import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PLANS,
  canAddConnection,
  canAddUser,
  canExport,
  canScheduleReports,
  evaluateResourceUsage,
  historyCutoff,
  isPlanCode,
  isScanDue,
} from './plans.ts';

test('isPlanCode aceita só planos existentes', () => {
  assert.ok(isPlanCode('inicial'));
  assert.ok(!isPlanCode('gratis'));
  assert.ok(!isPlanCode('toString')); // não confundir com propriedades herdadas
  assert.ok(!isPlanCode(undefined));
});

test('limite de conexões: bloqueia ao atingir, libera abaixo, sem limite no empresarial', () => {
  assert.deepEqual(canAddConnection('inicial', 0), { allowed: true });
  const d = canAddConnection('inicial', 1);
  assert.equal(d.allowed, false);
  assert.match(d.allowed ? '' : d.reason, /1 conexões/);
  assert.deepEqual(canAddConnection('profissional', 4), { allowed: true });
  assert.equal(canAddConnection('profissional', 5).allowed, false);
  assert.deepEqual(canAddConnection('empresarial', 9999), { allowed: true });
});

test('limite de usuários', () => {
  assert.equal(canAddUser('inicial', 2).allowed, false);
  assert.equal(canAddUser('inicial', 1).allowed, true);
});

test('exportação e relatórios agendados por plano', () => {
  assert.equal(canExport('inicial', 'csv').allowed, true);
  assert.equal(canExport('inicial', 'pdf').allowed, false);
  assert.equal(canExport('profissional', 'xlsx').allowed, true);
  assert.equal(canScheduleReports('inicial').allowed, false);
  assert.equal(canScheduleReports('profissional').allowed, true);
});

test('consumo de recursos: ok, near (>=90%), exceeded e ilimitado', () => {
  assert.equal(evaluateResourceUsage('inicial', 100).status, 'ok');
  assert.equal(evaluateResourceUsage('inicial', 179).status, 'ok');
  assert.equal(evaluateResourceUsage('inicial', 180).status, 'near');
  assert.equal(evaluateResourceUsage('inicial', 200).status, 'near');
  assert.deepEqual(evaluateResourceUsage('inicial', 230), { status: 'exceeded', used: 230, limit: 200, overBy: 30 });
  assert.equal(evaluateResourceUsage('empresarial', 1_000_000).status, 'ok');
});

test('isScanDue respeita o intervalo do plano', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  assert.equal(isScanDue('inicial', null, now), true);
  assert.equal(isScanDue('inicial', new Date('2026-11-01T00:00:01Z'), now), false); // 23h59 < 24h
  assert.equal(isScanDue('inicial', new Date('2026-10-31T12:00:00Z'), now), true); // exatamente 24h
  assert.equal(isScanDue('profissional', new Date('2026-11-01T06:00:00Z'), now), true); // 6h
  assert.equal(isScanDue('profissional', new Date('2026-11-01T06:00:01Z'), now), false);
});

test('historyCutoff calcula a data limite de retenção', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  assert.equal(historyCutoff('inicial', now)?.toISOString(), '2026-10-02T00:00:00.000Z');
  assert.equal(historyCutoff('profissional', now)?.toISOString(), '2025-11-01T00:00:00.000Z');
});

test('invariante: planos mais altos nunca têm menos do que os mais baixos', () => {
  assert.ok((PLANS.profissional.resources ?? 0) > (PLANS.inicial.resources ?? 0));
  assert.ok(PLANS.profissional.scanIntervalHours < PLANS.inicial.scanIntervalHours);
  assert.ok(PLANS.inicial.exports.every((f) => PLANS.profissional.exports.includes(f)));
});
