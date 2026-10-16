import { describe, expect, it, beforeEach } from 'vitest';
import { appendEvent, exportJson, loadEvents, verifyChain } from './prospective-ledger';
import { installLedgerTap } from './ledger-tap';
import { useAtlasStore } from '../store/atlas-store';
import type { AtlasAnalysis, Match } from '../atlas-types';

const mkMatch = (id: string, ko: string): Match => ({
  id, home: 'H', away: 'A', league: 'E0', country: 'England', gameType: 'standard',
  h: '2.0', d: '3.4', a: '3.6', userOdds: {}, kickoff: ko,
} as Match);
// probs 0.52 @ odds 2.0 => EV = 0.04 (inside the 0-3% band => full stake)
const fakeA = {
  pick: 'home', confidence: 0.55, probs: { home: 0.52, draw: 0.24, away: 0.24 },
  sofTriggered: false, margin: 0.06,
} as AtlasAnalysis;

describe('prospective ledger integrity', () => {
  it('hash chain verifies and duplicate eventIds no-op', () => {
    appendEvent({ type: 'skip', at: 1, eventId: 'x1', reason: 'test' });
    appendEvent({ type: 'skip', at: 2, eventId: 'x2', reason: 'test' });
    appendEvent({ type: 'skip', at: 3, eventId: 'x1', reason: 'dup' });
    const ev = loadEvents();
    expect(ev).toHaveLength(2);
    expect(verifyChain(ev).ok).toBe(true);
    expect(exportJson(ev).length).toBeGreaterThan(0);
  });
});

describe('ledger tap captures production events without mutating state', () => {
  beforeEach(() => useAtlasStore.setState({ predictions: [], duplicateSkips: 0, matches: [] }));

  it('records prediction, settlement and closing events with guard fields', () => {
    installLedgerTap();
    useAtlasStore.setState({ matches: [mkMatch('m1', '2030-01-01T10:00:00Z')] });
    useAtlasStore.getState().recordPrediction(mkMatch('m1', '2030-01-01T10:00:00Z'), fakeA);
    useAtlasStore.getState().submitResult('m1', 'home', 1.95);
    const ev = loadEvents();
    const pred = ev.find((e) => e.type === 'prediction' && e.matchId === 'm1');
    expect(pred).toBeDefined();
    expect(pred!.league).toBe('E0');
    expect(pred!.ev).toBeCloseTo(0.52 * 2.0 - 1, 9);
    expect(pred!.guardReason).toBe('full');
    expect(pred!.stakeUnits).toBe(1);
    expect(ev.some((e) => e.type === 'settlement' && e.predictionId === pred!.predictionId)).toBe(true);
    expect(ev.some((e) => e.type === 'closing' && e.closingOdds === 1.95)).toBe(true);
    expect(verifyChain(ev).ok).toBe(true);
    expect(useAtlasStore.getState().predictions).toHaveLength(1); // tap added nothing
  });
});