// ============================================================
// ATLAS evidence schema v2 (Independent Review Phase B)
// Versioned, deterministic export/import plus prospective-
// evidence integrity helpers. Pure functions, client-side
// only (Rule 7). Additive and decision-neutral.
// ============================================================
import type { PredictionRecord } from '../learning/bayesian-learning';
import type { LedgerRow } from '../analysis/lab-ledger';

export const EVIDENCE_SCHEMA_VERSION = 2;

export interface EvidenceExport {
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  predictions: PredictionRecord[];
  ledger: LedgerRow[];
}

export interface ParseResult {
  ok: boolean;
  data: EvidenceExport | null;
  errors: string[];
}

export function serializeEvidence(
  predictions: PredictionRecord[],
  ledger: LedgerRow[],
  appVersion = 'v9.10',
): string {
  const payload: EvidenceExport = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    predictions,
    ledger,
  };
  return JSON.stringify(payload);
}

export function parseEvidence(text: string): ParseResult {
  const errors: string[] = [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, data: null, errors: ['Invalid JSON'] }; }

  let version = 1;
  let predictions: PredictionRecord[] = [];
  let ledger: LedgerRow[] = [];
  let exportedAt = new Date().toISOString();
  let appVersion = 'v1-import';

  if (Array.isArray(raw)) {
    // v1 shape: bare predictions array
    predictions = raw as PredictionRecord[];
  } else if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Partial<EvidenceExport> & { session?: { predictions?: PredictionRecord[] } };
    if (typeof obj.schemaVersion === 'number') version = obj.schemaVersion;
    if (typeof obj.exportedAt === 'string') exportedAt = obj.exportedAt;
    if (typeof obj.appVersion === 'string') appVersion = obj.appVersion;
    if (Array.isArray(obj.predictions)) predictions = obj.predictions;
    else if (Array.isArray(obj.session?.predictions)) { predictions = obj.session!.predictions!; version = 1; }
    else errors.push('No predictions array found');
    if (Array.isArray(obj.ledger)) ledger = obj.ledger;
  } else {
    return { ok: false, data: null, errors: ['Not an object or array'] };
  }

  const clean: PredictionRecord[] = [];
  for (const p of predictions) {
    if (!p || typeof p !== 'object') { errors.push('skipped non-object prediction'); continue; }
    if (typeof p.id !== 'string' || !p.id) { errors.push('skipped prediction without id'); continue; }
    clean.push(version >= 2 ? p : migrateV1(p));
  }
  if (!clean.length) return { ok: false, data: null, errors: errors.length ? errors : ['No valid predictions'] };
  return {
    ok: true,
    data: { schemaVersion: EVIDENCE_SCHEMA_VERSION, exportedAt, appVersion, predictions: clean, ledger },
    errors,
  };
}

function migrateV1(p: PredictionRecord): PredictionRecord {
  const q = { ...p } as PredictionRecord & { late?: boolean };
  if (typeof q.late !== 'boolean') q.late = false;
  return q;
}

// Prospective-evidence integrity: a prediction recorded after kickoff
// cannot count as prospective evidence. Missing/unparseable kickoff
// means "unknown", treated as not-late but flaggable by the caller.
export function isLatePrediction(timestamp: number, kickoff: string | undefined): boolean {
  if (!kickoffParseable(kickoff)) return false;
  return timestamp > Date.parse(kickoff!);
}

export function kickoffParseable(kickoff: string | undefined): boolean {
  if (!kickoff) return false;
  return !Number.isNaN(Date.parse(kickoff));
}

// Duplicate-prevention key: same fixture + engine + card day.
// Case/whitespace-insensitive. Re-records on a later day stay allowed
// (matches the weekly re-paste routine); same-day doubles are blocked.
export function dedupeKey(rec: {
  home?: string; away?: string; league?: string; gameType?: string; timestamp?: number;
}): string {
  const day = rec.timestamp ? new Date(rec.timestamp).toISOString().slice(0, 10) : 'unknown';
  return [
    (rec.league ?? '').toLowerCase(),
    (rec.home ?? '').trim().toLowerCase(),
    (rec.away ?? '').trim().toLowerCase(),
    (rec.gameType ?? 'standard').toLowerCase(),
    day,
  ].join('|');
}