import { describe, expect, it, beforeEach } from 'vitest';
import { appendEvent, appendVoid, exportJson, getLedgerCounters, loadEvents, verifyChain } from './prospective-ledger';
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

describe('prospective ledger integrity (R9 validation)', () => {
  it('hash chain verifies and duplicate eventIds increment the counter, not the ledger', () => {
    const before = loadEvents().length;
    appendEvent({ type: 'skip', at: 1, eventId: 'x1', reason: 'test' });
    appendEvent({ type: 'skip', at: 2, eventId: 'x2', reason: 'test' });
    appendEvent({ type: 'skip', at: 3, eventId: 'x1', reason: 'dup' });
    expect(loadEvents().length).toBe(before + 2);
    expect(getLedgerCounters().duplicates).toBeGreaterThanOrEqual(1);
    expect(verifyChain(loadEvents()).ok).toBe(true);
    expect(exportJson(loadEvents()).length).toBeGreaterThan(0);
  });

  it('prediction without probs is rejected with an explicit reject event', () => {
    const before = loadEvents().length;
    const out = appendEvent({ type: 'prediction', at: 10, eventId: 'bad-pred', predictionId: 'bp1', gameType: 'standard', pick: 'home' });
    expect(out.type).toBe('reject');
    expect(out.rejectedType).toBe('prediction');
    expect(out.reason).toContain('probs');
    const ev = loadEvents();
    expect(ev.length).toBe(before + 1);
    expect(ev[ev.length - 1].type).toBe('reject');
    expect(getLedgerCounters().rejects).toBeGreaterThanOrEqual(1);
  });

  it('settlement without result is rejected', () => {
    const out = appendEvent({ type: 'settlement', at: 11, eventId: 'bad-settle', predictionId: 'bp2' });
    expect(out.type).toBe('reject');
    expect(out.reason).toContain('result');
  });

  it('void events carry explicit status and keep the chain valid', () => {
    const out = appendVoid('bp3', 'postponed-test');
    expect(out.type).toBe('void');
    expect(out.status).toBe('void');
    expect(verifyChain(loadEvents()).ok).toBe(true);
  });
});

describe('ledger tap captures production events without mutating state (R9 closing sources)', () => {
  beforeEach(() => useAtlasStore.setState({ predictions: [], duplicateSkips: 0, matches: [] }));

  it('records prediction, settlement (manual-settlement closing) with guard fields', () => {
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
    const settle = ev.find((e) => e.type === 'settlement' && e.predictionId === pred!.predictionId);
    expect(settle).toBeDefined();
    expect(settle!.status).toBe('settled');
    const close = ev.find((e) => e.type === 'closing' && e.predictionId === pred!.predictionId);
    expect(close).toBeDefined();
    expect(close!.closingOdds).toBe(1.95);
    expect(close!.closingSource).toBe('manual-settlement');
    expect(verifyChain(ev).ok).toBe(true);
    expect(useAtlasStore.getState().predictions).toHaveLength(1); // tap added nothing
  });

  it('repaste-path closing (no result yet) is attributed repaste-snapshot', () => {
    installLedgerTap();
    useAtlasStore.setState({ matches: [mkMatch('m2', '2030-01-01T10:00:00Z')] });
    useAtlasStore.getState().recordPrediction(mkMatch('m2', '2030-01-01T10:00:00Z'), fakeA);
    const n = useAtlasStore.getState().snapshotClosing([{ home: 'H', away: 'A', h: '1.90', d: '3.50', a: '3.80' }]);
    expect(n).toBe(1);
    const ev = loadEvents();
    const pred = ev.find((e) => e.type === 'prediction' && e.matchId === 'm2');
    const close = ev.find((e) => e.type === 'closing' && e.predictionId === pred!.predictionId);
    expect(close).toBeDefined();
    expect(close!.closingSource).toBe('repaste-snapshot');
  });
});