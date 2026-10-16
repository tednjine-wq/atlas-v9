import { describe, expect, it } from 'vitest';
import { runShadow } from './c1-shadow';
import type { ProspectiveEvent } from '../evidence/prospective-ledger';
import type { Outcome } from '../atlas-types';

const P = (h: number, d: number, a: number): Record<Outcome, number> => ({ home: h, draw: d, away: a });
const pred = (id: string, probs: Record<Outcome, number>, league = 'E0'): ProspectiveEvent =>
  ({ v: 2, type: 'prediction', at: 1000, eventId: `pred:${id}`, prevHash: 'x', hash: 'x', predictionId: id, probs, league } as ProspectiveEvent);
const settle = (id: string, result: Outcome, at: number): ProspectiveEvent =>
  ({ v: 2, type: 'settlement', at, eventId: `settle:${id}`, prevHash: 'x', hash: 'x', predictionId: id, result, resolvedAt: at } as ProspectiveEvent);

const miscal = P(0.30, 0.30, 0.40); // under-states home systematically
const events: ProspectiveEvent[] = [];
for (let i = 0; i < 60; i++) {
  events.push(pred(`p${i}`, miscal));
  events.push(settle(`p${i}`, i % 10 < 5 ? 'home' : 'draw', 2000 + i)); // true home rate 50%
}

describe('C1 shadow runner (research-only, promotion requires Phase D gate)', () => {
  const res = runShadow(events);

  it('scores every settled prediction once, chronologically', () => {
    expect(res.rows).toHaveLength(60);
    for (let i = 1; i < res.rows.length; i++) expect(res.rows[i].date).toBeGreaterThanOrEqual(res.rows[i - 1].date);
  });

  it('below the evidence floor the candidate is exactly the control', () => {
    const early = runShadow(events.slice(0, 40)); // <30 settled at every step
    expect(early.rows.slice(0, 29).map((r) => r.candidate)).toEqual(early.rows.slice(0, 29).map((r) => r.control));
  });

  it('candidate probabilities stay normalized', () => {
    for (const r of res.rows) {
      const s = r.candidate.home + r.candidate.draw + r.candidate.away;
      expect(s).toBeCloseTo(1, 9);
    }
  });

  it('deterministic replay and paired reports', () => {
    expect(runShadow(events)).toEqual(res);
    expect(res.control.n).toBe(60);
    expect(res.candidate.n).toBe(60);
  });
});