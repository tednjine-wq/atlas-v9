// ============================================================
// Pre-registered CLV convention (R11-parlay):
//   CLV = 1/closing - 1/entry  (implied-probability difference)
//   positive = closing implies HIGHER probability for the
//   selected outcome than the entry price.
// Computed ONLY for captures classified 'closing'.
// Not a de-vigged comparison; documented as such.
// ============================================================
import type { OddsCapture } from './parlay-ledger';

export const CLV_CONVENTION =
  'CLV = 1/closing - 1/entry on the selected outcome (decimal odds); positive = closing implies higher selection probability; raw implied probs, NOT de-vigged';

export function clvForLeg(entryOdds: number, capture: OddsCapture | null): number | null {
  if (!capture || capture.klass !== 'closing' || !(capture.odds > 1) || !(entryOdds > 1)) return null;
  return 1 / capture.odds - 1 / entryOdds;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function clvSummary(pairs: { entryOdds: number; capture: OddsCapture | null }[]) {
  const vals: number[] = [];
  let eligible = 0, missing = 0;
  for (const p of pairs) {
    const v = clvForLeg(p.entryOdds, p.capture);
    if (v === null) missing++; else { eligible++; vals.push(v); }
  }
  const mean = vals.length ? vals.reduce((a, x) => a + x, 0) / vals.length : null;
  return {
    eligible, missing, mean, median: vals.length ? median(vals) : null,
    aggregate: mean, weighting: 'simple (leg-count-weighted) mean over eligible legs; slip-level aggregate = same mean, no stake weighting',
    convention: CLV_CONVENTION,
  };
}