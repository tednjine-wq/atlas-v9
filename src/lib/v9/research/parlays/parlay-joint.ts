// ============================================================
// Joint-probability rules (R11-parlay), Standard configuration:
// rho = -0.13 WITHIN a match only; cross-match legs combine by
// product (preserved independence). Same-match multi-selection
// uses exact score-matrix enumeration (never independence).
// Probabilities are RESEARCH RECOMPUTATIONS of the Standard
// engine path (calibrateLambda grid search -> DC grid); they are
// labelled 'research-recomputed' and are NOT stored production
// outputs.
// ============================================================
import type { Outcome } from '../../atlas-types';
import { calibrateLambda } from '../../math/calibration';
import { dcGridMatrix } from '../markets/ou-extract';

export const ATLAS_PROB_VERSION = 'research-recomputed-v9.10-rho-0.13';
const RHO_STD = -0.13;

export interface LegProbInput { matchKey: string; h: number; d: number; a: number; market: '1x2' | 'ou25'; selection: string; }

export function standardProb1x2(h: number, d: number, a: number, rho = RHO_STD): Record<Outcome, number> | null {
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const cal = calibrateLambda(h, d, a, rho, undefined);
  const g = dcGridMatrix(cal.lambdaH, cal.lambdaA, rho);
  let hh = 0, dr = 0, aw = 0;
  for (let y = 0; y <= 9; y++) for (let x = 0; x <= 9; x++) {
    const p = g.raw[y][x] / g.sum;
    if (x > y) hh += p; else if (x === y) dr += p; else aw += p;
  }
  return { home: hh, draw: dr, away: aw };
}

export function standardProbSelection(inp: LegProbInput): number | null {
  if (!(inp.h > 1 && inp.d > 1 && inp.a > 1)) return null;
  const cal = calibrateLambda(inp.h, inp.d, inp.a, RHO_STD, undefined);
  const g = dcGridMatrix(cal.lambdaH, cal.lambdaA, RHO_STD);
  let acc = 0;
  for (let y = 0; y <= 9; y++) for (let x = 0; x <= 9; x++) {
    if (satisfies(inp, x, y)) acc += g.raw[y][x] / g.sum;
  }
  return acc;
}

function satisfies(inp: LegProbInput, i: number, j: number): boolean {
  if (inp.market === 'ou25') return inp.selection === 'over' ? i + j > 2.5 : i + j < 2.5;
  if (inp.selection === 'home') return i > j;
  if (inp.selection === 'draw') return i === j;
  return j > i;
}

// Exact same-match joint probability by enumeration over the grid.
export function sameMatchJoint(h: number, d: number, a: number, selections: { market: '1x2' | 'ou25'; selection: string }[]): number | null {
  if (!(h > 1 && d > 1 && a > 1) || selections.length === 0) return null;
  const cal = calibrateLambda(h, d, a, RHO_STD, undefined);
  const g = dcGridMatrix(cal.lambdaH, cal.lambdaA, RHO_STD);
  let acc = 0;
  for (let y = 0; y <= 9; y++) for (let x = 0; x <= 9; x++) {
    const inp: LegProbInput = { matchKey: '', h, d, a, market: selections[0].market, selection: selections[0].selection };
    void inp;
    if (selections.every((s) => satisfies({ matchKey: '', h, d, a, market: s.market, selection: s.selection }, x, y))) acc += g.raw[y][x] / g.sum;
  }
  return acc;
}

// Slip joint: product across distinct matches; exact enumeration within a match.
export function slipJointProb(legs: LegProbInput[]): number | null {
  const byMatch = new Map<string, LegProbInput[]>();
  for (const l of legs) {
    const arr = byMatch.get(l.matchKey) ?? [];
    arr.push(l); byMatch.set(l.matchKey, arr);
  }
  let joint = 1;
  for (const group of byMatch.values()) {
    const first = group[0];
    if (group.length === 1) {
      const p = standardProbSelection(first);
      if (p === null) return null;
      joint *= p;
    } else {
      const p = sameMatchJoint(first.h, first.d, first.a, group.map((g) => ({ market: g.market, selection: g.selection })));
      if (p === null) return null;
      joint *= p;
    }
  }
  return joint;
}