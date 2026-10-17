import { describe, expect, it } from 'vitest';
import { blend, pairedBrierDiff } from './residual-signal';
import type { ResidualRow } from './residual-signal';
import type { Outcome } from '../atlas-types';

const P = (h: number, d: number, a: number) => ({ home: h, draw: d, away: a });

describe('residual-signal math (PATH B gate)', () => {
  it('lambda=0 blend is exactly the market', () => {
    expect(blend(P(0.5, 0.3, 0.2), P(0.9, 0.05, 0.05), 0)).toEqual(P(0.5, 0.3, 0.2));
  });

  it('paired diff is negative when the residual carries true signal', () => {
    const rows: ResidualRow[] = [];
    for (let i = 0; i < 200; i++) {
      // market says 1/3 each; ATLAS leans home; truth is home 70% of the time
      rows.push({ predictionId: `r${i}`, date: i, devig: P(1 / 3, 1 / 3, 1 / 3), probs: P(0.6, 0.25, 0.15), outcome: i % 10 < 7 ? 'home' : 'draw' });
    }
    const d = pairedBrierDiff(rows);
    expect(d.n).toBe(200);
    expect(d.mean).toBeLessThan(0);
    expect(d.hi).toBeLessThan(0); // CI excludes zero in favour of residual
  });
});