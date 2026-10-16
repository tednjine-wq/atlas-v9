import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_SCHEMA_VERSION, dedupeKey, isLatePrediction, kickoffParseable,
  parseEvidence, serializeEvidence,
} from './evidence-schema';
import type { PredictionRecord } from '../learning/bayesian-learning';

const pred = (id: string, over: Partial<PredictionRecord> = {}): PredictionRecord =>
  ({
    id, home: 'Arsenal', away: 'Chelsea', league: 'E0', gameType: 'standard',
    timestamp: Date.parse('2026-10-10T12:00:00Z'),
    probs: { home: 0.5, draw: 0.25, away: 0.25 }, pick: 'home',
    ...over,
  }) as PredictionRecord;

describe('evidence schema v2', () => {
  it('round-trips predictions and ledger deterministically', () => {
    const s = serializeEvidence([pred('a'), pred('b')], []);
    const r = parseEvidence(s);
    expect(r.ok).toBe(true);
    expect(r.data!.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
    expect(r.data!.predictions.map((p) => p.id)).toEqual(['a', 'b']);
    expect(serializeEvidence(r.data!.predictions, [], r.data!.appVersion).length).toBeGreaterThan(0);
  });

  it('migrates v1 bare-array exports', () => {
    const r = parseEvidence(JSON.stringify([pred('x')]));
    expect(r.ok).toBe(true);
    const p = r.data!.predictions[0] as PredictionRecord & { late?: boolean };
    expect(p.late).toBe(false);
  });

  it('rejects garbage with errors', () => {
    expect(parseEvidence('not json').ok).toBe(false);
    expect(parseEvidence('{"foo":1}').ok).toBe(false);
    expect(parseEvidence('[{"nope":true}]').ok).toBe(false);
  });

  it('flags post-kickoff records as late, unknown kickoff as not-late', () => {
    const ko = '2026-10-10T14:00:00Z';
    expect(isLatePrediction(Date.parse('2026-10-10T15:00:00Z'), ko)).toBe(true);
    expect(isLatePrediction(Date.parse('2026-10-10T12:00:00Z'), ko)).toBe(false);
    expect(isLatePrediction(Date.parse('2026-10-10T15:00:00Z'), undefined)).toBe(false);
    expect(isLatePrediction(Date.parse('2026-10-10T15:00:00Z'), 'garbage')).toBe(false);
    expect(kickoffParseable(ko)).toBe(true);
    expect(kickoffParseable('garbage')).toBe(false);
  });

  it('dedupe keys ignore case/whitespace but separate engine and day', () => {
    const a = dedupeKey({ home: ' Arsenal ', away: 'CHELSEA', league: 'e0', gameType: 'standard', timestamp: Date.parse('2026-10-10T12:00:00Z') });
    const b = dedupeKey({ home: 'arsenal', away: 'Chelsea', league: 'E0', gameType: 'standard', timestamp: Date.parse('2026-10-10T18:00:00Z') });
    const c = dedupeKey({ home: 'arsenal', away: 'chelsea', league: 'E0', gameType: 'jackpot', timestamp: Date.parse('2026-10-10T12:00:00Z') });
    const d = dedupeKey({ home: 'arsenal', away: 'chelsea', league: 'E0', gameType: 'standard', timestamp: Date.parse('2026-10-11T12:00:00Z') });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});