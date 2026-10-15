import { describe, expect, it } from 'vitest';
import { buildScoreMatrix } from './dixon-coles';

describe('§J truncation tail mass', () => {
  it('tailMass < 0.005 for typical lambda (2.0)', () => {
    expect(buildScoreMatrix(2.0, 1.5, -0.13).tailMass).toBeLessThan(0.005);
  });
  it('tailMass measurable for high lambda (3.5)', () => {
    const r = buildScoreMatrix(3.5, 3.0, -0.13);
    expect(r.tailMass).toBeGreaterThan(0.001);
    expect(r.tailMass).toBeLessThan(0.05);
  });
  it('matrix normalizes to 1 and tailMass equals 1 - pre-norm sum', () => {
    const r = buildScoreMatrix(1.8, 1.2, -0.13);
    expect(r.matrix.reduce((s, e) => s + e.p, 0)).toBeCloseTo(1, 9);
    expect(r.tailMass).toBeCloseTo(Math.max(0, 1 - r.sum), 12);
  });
});