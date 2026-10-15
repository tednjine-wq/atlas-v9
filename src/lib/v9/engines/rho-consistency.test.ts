import { describe, expect, it } from 'vitest';
import { DC_RHO_JACKPOT, DC_RHO_STANDARD } from '../atlas-types';
import type { Match } from '../atlas-types';
import { buildScoreMatrix } from '../math/dixon-coles';
import { atlasAnalyseV9 } from './standard';
import { atlasAnalyseJackpotV9 } from './jackpot';
import { defaultParams } from '../learning/bayesian-learning';

const m = {
  id: 'r1', home: 'H', away: 'A', league: 'E0', country: 'England', gameType: 'standard',
  h: '2.0', d: '3.4', a: '3.6', userOdds: {}, kickoff: '2026-10-20T15:00:00Z',
} as Match;

describe('P0 rho consistency', () => {
  it('production rho constants are frozen', () => {
    expect(DC_RHO_STANDARD).toBe(-0.13);
    expect(DC_RHO_JACKPOT).toBe(-0.08);
  });
  it('standard score matrix ignores rhoAdjust (no silent rho drift)', () => {
    const a = atlasAnalyseV9(m, 0.10, { ...defaultParams(), rhoAdjust: -0.05 });
    const ref = buildScoreMatrix(a.calibration.lambdaH, a.calibration.lambdaA, DC_RHO_STANDARD);
    expect(a.scoreMatrix[0].p).toBeCloseTo(ref.matrix[0].p, 12);
    expect(a.scoreMatrix.length).toBe(ref.matrix.length);
  });
  it('jackpot score matrix uses jackpot rho', () => {
    const a = atlasAnalyseJackpotV9(m, 0.10);
    const ref = buildScoreMatrix(a.calibration.lambdaH, a.calibration.lambdaA, DC_RHO_JACKPOT);
    expect(a.scoreMatrix[0].p).toBeCloseTo(ref.matrix[0].p, 12);
  });
});