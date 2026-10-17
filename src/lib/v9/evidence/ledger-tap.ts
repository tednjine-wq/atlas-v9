// ============================================================
// Ledger tap: subscribes to the store and records audit events.
// READ-ONLY with respect to production state: never mutates
// matches, predictions, params, guard or staking. Activated by
// a single import in the atlas page (after 'use client').
// R7: pre-install timestamps label backfill (rehydrate race).
// R9: closing-source attribution via transition shape
// (closing arrives with result => manual-settlement; without
// => repaste-snapshot; rehydrate-era => unattributed-path),
// settlement status stamping, and a console diagnostics hook
// (__atlasLedger: appendVoid / counters / chain check).
// ============================================================
import { useAtlasStore } from '../store/atlas-store';
import type { PredictionRecord } from '../learning/bayesian-learning';
import { appendEvent, getLedgerCounters, GUARD_POLICY_VERSION, MODEL_VERSION, loadEvents, verifyChain, appendVoid } from './prospective-ledger';
import { guardedStakeFromEv } from '../analysis/lab-ledger';
import type { Outcome } from '../atlas-types';

type Rec = PredictionRecord & { evKey?: string; late?: boolean; label?: string };

const guardFields = (probs: Record<Outcome, number>, pick: Outcome, entry: Record<Outcome, number> | undefined) => {
  if (!entry || !(entry.home > 1 && entry.draw > 1 && entry.away > 1)) {
    return { ev: null, guardStake: 0, guardReason: 'no-valid-entry-odds', stakeUnits: 0 };
  }
  const odds = entry[pick];
  const ev = probs[pick] * odds - 1;
  const stake = guardedStakeFromEv(ev, odds);
  const reason = ev <= 0 ? 'ev<=0' : ev > 0.06 ? 'band-hi-skip' : odds < 1.5 ? 'odds<1.5-half' : 'full';
  return { ev, guardStake: stake, guardReason: reason, stakeUnits: stake };
};

let installed = false;
let INSTALL_TS = 0;

export function installLedgerTap(): void {
  if (installed) return;
  installed = true;
  INSTALL_TS = Date.now();
  const seenPred = new Set<string>();
  const seenSettle = new Set<string>();
  const seenClose = new Set<string>();

  const capture = (p: Rec, backfilled: boolean) => {
    if (seenPred.has(p.id)) return;
    seenPred.add(p.id);
    const isBack = backfilled || p.timestamp < INSTALL_TS;
    const s = useAtlasStore.getState();
    const match = s.matches.find((m) => m.id === p.matchId);
    const g = guardFields(p.probs, p.pick, p.entryOdds);
    appendEvent({
      type: isBack ? 'backfill' : 'prediction',
      at: isBack ? p.timestamp : Date.now(),
      eventId: `pred:${p.id}`,
      predictionId: p.id, matchId: p.matchId, label: p.label,
      league: match?.league ?? null, kickoff: match?.kickoff ?? null,
      gameType: p.gameType, pick: p.pick, probs: { ...p.probs },
      entryOdds: p.entryOdds ?? null, oddsSource: 'manual-entry', oddsAt: p.timestamp,
      phi: s.phi, ev: g.ev, guardStake: g.guardStake, guardReason: g.guardReason, stakeUnits: g.stakeUnits,
      modelVersion: MODEL_VERSION, guardPolicyVersion: GUARD_POLICY_VERSION,
      backfilled: isBack || undefined,
    });
  };

  for (const p of useAtlasStore.getState().predictions as Rec[]) capture(p, true);

  useAtlasStore.subscribe((s, prev) => {
    for (const p of s.predictions as Rec[]) {
      capture(p, false);
      if (p.result && !seenSettle.has(p.id)) {
        seenSettle.add(p.id);
        appendEvent({
          type: 'settlement', at: p.resolvedAt ?? Date.now(), eventId: `settle:${p.id}`,
          predictionId: p.id, result: p.result, resolvedAt: p.resolvedAt, status: 'settled',
        });
      }
      if (p.closingOdds && p.closingOdds > 1 && !seenClose.has(p.id)) {
        seenClose.add(p.id);
        const before = (prev.predictions as Rec[]).find((x) => x.id === p.id);
        const source = before ? (before.result ? 'manual-settlement' : 'repaste-snapshot') : 'unattributed-path';
        appendEvent({
          type: 'closing', at: Date.now(), eventId: `close:${p.id}`,
          predictionId: p.id, closingOdds: p.closingOdds, closingSource: source, clv: p.clv ?? null,
        });
      }
    }
  });
}

installLedgerTap();

// Operator/audit diagnostics (no behaviour change): void marking,
// counter inspection, chain verification from the browser console.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__atlasLedger = {
    appendVoid, getLedgerCounters, verify: () => verifyChain(loadEvents()), count: () => loadEvents().length,
  };
}