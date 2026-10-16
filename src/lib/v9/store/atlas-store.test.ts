import { describe, expect, it, beforeEach } from 'vitest';
import { useAtlasStore } from './atlas-store';
import type { AtlasAnalysis, Match } from '../atlas-types';
import type { PredictionRecord } from '../learning/bayesian-learning';

type PredLate = PredictionRecord & { late?: boolean };

const mkMatch = (id: string, ko: string): Match => ({
  id, home: 'H', away: 'A', league: 'E0', country: 'England', gameType: 'standard',
  h: '2.0', d: '3.4', a: '3.6', userOdds: {}, kickoff: ko,
} as Match);

const fakeA = {
  pick: 'home', confidence: 0.55, probs: { home: 0.5, draw: 0.25, away: 0.25 },
  sofTriggered: false, margin: 0.06,
} as AtlasAnalysis;

describe('recordPrediction prospective integrity (Phase B2)', () => {
  beforeEach(() => useAtlasStore.setState({ predictions: [], duplicateSkips: 0, matches: [] }));

  it('stamps late=true when recorded after kickoff', () => {
    useAtlasStore.getState().recordPrediction(mkMatch('m1', '2020-01-01T10:00:00Z'), fakeA);
    const p = useAtlasStore.getState().predictions[0] as PredLate;
    expect(p.late).toBe(true);
  });

  it('stamps late=false when recorded before kickoff', () => {
    useAtlasStore.getState().recordPrediction(mkMatch('m1', '2030-01-01T10:00:00Z'), fakeA);
    const p = useAtlasStore.getState().predictions[0] as PredLate;
    expect(p.late).toBe(false);
  });

  it('blocks same-day duplicate fixture under a different match id', () => {
    useAtlasStore.getState().recordPrediction(mkMatch('m1', '2030-01-01T10:00:00Z'), fakeA);
    useAtlasStore.getState().recordPrediction(mkMatch('m2', '2030-01-01T10:00:00Z'), fakeA);
    const s = useAtlasStore.getState();
    expect(s.predictions.length).toBe(1);
    expect(s.duplicateSkips).toBe(1);
  });

  it('still allows same-matchId re-record (odds-edit flow)', () => {
    useAtlasStore.getState().recordPrediction(mkMatch('m1', '2030-01-01T10:00:00Z'), fakeA);
    useAtlasStore.getState().recordPrediction(mkMatch('m1', '2030-01-01T10:00:00Z'), fakeA);
    const s = useAtlasStore.getState();
    expect(s.predictions.length).toBe(1);
    expect(s.duplicateSkips).toBe(0);
  });

  it('export/import round-trips predictions through schema v2', () => {
    useAtlasStore.getState().recordPrediction(mkMatch('m1', '2030-01-01T10:00:00Z'), fakeA);
    const json = useAtlasStore.getState().exportSession();
    expect(json).toContain('"schemaVersion": 2');
    useAtlasStore.setState({ predictions: [], duplicateSkips: 0 });
    const ok = useAtlasStore.getState().importSession(json);
    expect(ok).toBe(true);
    expect(useAtlasStore.getState().predictions.length).toBe(1);
  });
});