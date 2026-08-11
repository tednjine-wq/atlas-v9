// ============================================================
// Gaussian-copula HT/FT joint distribution — v9.0 upgrade.
// v8.7 assumed independent halves; verified empirically that this
// underprices same-result continuation (H/H) by ~2x.
// Method: latent correlated normals mapped through margins
// (discrete Gaussian copula via MC, seeded for reproducibility).
// ============================================================
import { normCDF, mulberry32 } from './poisson';
import { buildScoreMatrix, outcomeProbs } from './dixon-coles';
import type { Outcome, HTFTJoint } from '../atlas-types';

const ORDER: Outcome[] = ['home', 'draw', 'away'];
const KEY: Record<string, string> = {
  'home_home': '1_1', 'home_draw': '1_X', 'home_away': '1_2',
  'draw_home': 'X_1', 'draw_draw': 'X_X', 'draw_away': 'X_2',
  'away_home': '2_1', 'away_draw': '2_X', 'away_away': '2_2',
};

// theta: rank correlation between half outcomes (0.65 default from
// Bundesliga copula studies 2024-25; league-tunable in Phase 4)
export function htftCopulaJoint(
  lH: number, lA: number, rho: number, theta = 0.65, nSims = 20000, seed = 7,
): HTFTJoint {
  const sm = buildScoreMatrix(lH, lA, rho);
  const ft = outcomeProbs(sm.raw, sm.sum);
  const hts = buildScoreMatrix(lH / 2, lA / 2, rho); // Poisson splitting (half lambdas)
  const ht = outcomeProbs(hts.raw, hts.sum);

  const cHT = [ht.home, ht.home + ht.draw];          // cumulative thresholds
  const cFT = [ft.home, ft.home + ft.draw];
  const rhoG = Math.sin((theta * Math.PI) / 2);       // rank -> linear correlation
  const rhoC = Math.sqrt(1 - rhoG * rhoG);
  const rng = mulberry32(seed);

  const joint = new Float64Array(9);
  for (let n = 0; n < nSims; n++) {
    // Box-Muller pair for two independent normals
    const u1 = Math.max(rng(), 1e-12), u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const z1 = r * Math.cos(2 * Math.PI * u2);
    const z2 = r * Math.sin(2 * Math.PI * u2);
    const w2 = rhoG * z1 + rhoC * z2;
    const v1 = normCDF(z1), v2 = normCDF(w2);
    const x = v1 < cHT[0] ? 0 : v1 < cHT[1] ? 1 : 2;
    const y = v2 < cFT[0] ? 0 : v2 < cFT[1] ? 1 : 2;
    joint[x * 3 + y]++;
  }
  const combos: Record<string, number> = {};
  ORDER.forEach((ho, x) => ORDER.forEach((fo, y) => {
    combos[KEY[`${ho}_${fo}`]] = joint[x * 3 + y] / nSims;
  }));
  return { combos, theta, method: 'gaussian-copula-mc' };
}
