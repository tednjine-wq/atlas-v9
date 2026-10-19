// ============================================================
// Settlement, reconciliation, hit-rate and drawdown rules
// (R11-parlay). Pending is never a loss; voids reported
// separately; winning slips use actual payout terms when
// verified, documented combined-odds fallback otherwise.
// ============================================================
import type { LegRecord, LegStatus, SlipRecord, SlipStatus } from './parlay-ledger';

export function settleLeg(market: LegRecord['market'], selection: string, hg: number, ag: number): 'won' | 'lost' {
  if (market === '1x2') {
    const actual = hg > ag ? 'home' : hg === ag ? 'draw' : 'away';
    return selection === actual ? 'won' : 'lost';
  }
  const total = hg + ag;
  const actual = total > 2.5 ? 'over' : 'under';
  return selection === actual ? 'won' : 'lost';
}

export function slipStatusFromLegs(legs: LegStatus[]): SlipStatus {
  if (legs.some((l) => l === 'lost')) return 'settled';
  if (legs.some((l) => l === 'pending')) return 'pending';
  if (legs.every((l) => l === 'void' || l === 'push')) return legs.length ? 'void' : 'open';
  return legs.every((l) => l === 'won' || l === 'void' || l === 'push') && legs.some((l) => l === 'won') ? 'settled' : 'open';
}

// Void/push legs are removed at odds 1.0 (documented bookmaker convention).
export function voidAdjustedCombined(legs: Pick<LegRecord, 'entryOdds' | 'status'>[]): number {
  return legs.reduce((acc, l) => acc * (l.status === 'void' || l.status === 'push' ? 1 : l.entryOdds), 1);
}

export interface SlipReconciliation { grossReturn: number | null; netPl: number | null; basis: string; }

export function reconcileSlip(slip: SlipRecord, legs: Pick<LegRecord, 'entryOdds' | 'status'>[]): SlipReconciliation {
  const status = slipStatusFromLegs(legs.map((l) => l.status));
  if (status === 'pending' || status === 'open') return { grossReturn: null, netPl: null, basis: 'not-final' };
  if (status === 'void') return { grossReturn: slip.stake, netPl: 0, basis: 'slip-void-stake-returned' };
  const anyLost = legs.some((l) => l.status === 'lost');
  if (anyLost) return { grossReturn: 0, netPl: -slip.stake, basis: 'losing-slip' };
  if (slip.payoutVerified) return { grossReturn: slip.potentialPayout, netPl: slip.potentialPayout - slip.stake, basis: 'actual-payout-terms' };
  const combined = voidAdjustedCombined(legs);
  return { grossReturn: slip.stake * combined, netPl: slip.stake * combined - slip.stake, basis: 'combined-odds-fallback-unverified-payout' };
}

export function slipHitRate(settled: { status: SlipStatus; won: boolean }[]): { won: number; settled: number; rate: number | null; voids: number } {
  const voids = settled.filter((s) => s.status === 'void').length;
  const counted = settled.filter((s) => s.status === 'settled');
  const won = counted.filter((s) => s.won).length;
  return { won, settled: counted.length, rate: counted.length ? won / counted.length : null, voids };
}

// Convention: cumulative net P/L from a zero baseline, chronological
// by settledAt; maxDD = max over prefixes of (running peak - running cum).
export function maxDrawdown(chronologicalNetPl: number[]): { value: number; convention: string; n: number } {
  let cum = 0, peak = 0, dd = 0;
  for (const x of chronologicalNetPl) {
    cum += x;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return { value: dd, convention: 'cumulative-net-PL-from-zero-baseline, chronological by settledAt', n: chronologicalNetPl.length };
}