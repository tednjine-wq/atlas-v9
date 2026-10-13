import { describe, expect, it } from 'vitest';
import { htftCopulaJoint } from './copula';

describe('HT/FT Gaussian Copula', () => {
  it('joint probabilities sum to ~1', () => {
    const j = htftCopulaJoint(1.5, 1.2, -0.13);
    const sum = Object.values(j.combos).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it('same-result continuation (H/H) is higher than independence', () => {
    const j = htftCopulaJoint(1.8, 1.0, -0.13);
    const pH = j.combos['1_1'] + j.combos['1_X'] + j.combos['1_2'];
    const fH = j.combos['1_1'] + j.combos['X_1'] + j.combos['2_1'];
    expect(j.combos['1_1']).toBeGreaterThan(pH * fH);
  });
});