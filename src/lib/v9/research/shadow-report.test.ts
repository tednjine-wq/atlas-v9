import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { ProspectiveEvent } from '../evidence/prospective-ledger';
import { verifyChain } from '../evidence/prospective-ledger';
import { runShadow } from './c1-shadow';

const PATH = process.env.PROSPECTIVE_LEDGER_JSON;
const FREEZE_ISO = (() => {
  try { return execSync('git log -1 --format=%cI 2f739f0', { encoding: 'utf8' }).trim(); }
  catch { return '2026-10-17T00:00:00Z'; }
})();
const DAY = 86400000;

// R8: cohort is a property of the PREDICTION (oddsAt vs freeze).
// R9: paired diffs + reject/void/orphan/missing accounting lines.
describe('C1 shadow report vs frozen control (research-only; promotion requires Phase D gate)', () => {
  const available = !!PATH && existsSync(PATH);
  it.skipIf(!available)('prints paired control-vs-candidate metrics per cohort', () => {
    const events = JSON.parse(readFileSync(PATH!, 'utf8')) as ProspectiveEvent[];
    const chain = verifyChain(events);
    const freeze = Date.parse(FREEZE_ISO);
    const predCohort = new Map<string, 'primary' | 'secondary'>();
    for (const e of events) {
      if ((e.type === 'prediction' || e.type === 'backfill') && e.predictionId) {
        predCohort.set(e.predictionId, (e.oddsAt ?? e.at) >= freeze ? 'primary' : 'secondary');
      }
    }
    const cohortOf = (e: ProspectiveEvent) => (e.predictionId ? predCohort.get(e.predictionId) : undefined);
    const counts = { primary: 0, secondary: 0 };
    for (const e of events) { const c = cohortOf(e); if (c) counts[c]++; }

    const settledIds = new Set(events.filter((e) => e.type === 'settlement').map((e) => e.predictionId));
    const voidIds = new Set(events.filter((e) => e.type === 'void').map((e) => e.predictionId));
    const maxAt = Math.max(...events.map((e) => e.at));
    let orphansPending = 0, orphansMissing = 0;
    for (const e of events) {
      if ((e.type !== 'prediction' && e.type !== 'backfill') || !e.predictionId) continue;
      if (settledIds.has(e.predictionId) || voidIds.has(e.predictionId)) continue;
      if (maxAt - (e.oddsAt ?? e.at) > 30 * DAY) orphansMissing++; else orphansPending++;
    }

    const f = (r: { model: string; n: number; brier: number; brierCi: { lo: number; hi: number }; logLoss: number; rps: number }) =>
      `${r.model.padEnd(16)} n=${String(r.n).padEnd(4)} brier=${r.brier.toFixed(4)} [${r.brierCi.lo.toFixed(4)},${r.brierCi.hi.toFixed(4)}] ll=${r.logLoss.toFixed(4)} rps=${r.rps.toFixed(4)}`;
    const pf = (tag: string, s: { n: number; mean: number; lo: number; hi: number }) =>
      `${tag.padEnd(16)} n=${String(s.n).padEnd(4)} pairedDiff=${s.mean.toFixed(4)} [${s.lo.toFixed(4)},${s.hi.toFixed(4)}]`;
    const rejects = events.filter((e) => e.type === 'reject').length;
    const voids = events.filter((e) => e.type === 'void').length;
    const lines = [
      `chainOk=${chain.ok} freeze=${FREEZE_ISO} primaryEvents=${counts.primary} secondaryEvents=${counts.secondary}`,
      `integrity: rejects=${rejects} voids=${voids} orphansPending(<=30d)=${orphansPending} orphansMissing(>30d)=${orphansMissing}`,
    ];
    for (const tag of ['secondary', 'primary'] as const) {
      const res = runShadow(events.filter((e) => cohortOf(e) === tag));
      lines.push(
        `--- ${tag} cohort ---`, f(res.control), f(res.candidate),
        pf('brier(cand-ctrl)', res.paired.brier), pf('ll(cand-ctrl)', res.paired.logLoss), pf('rps(cand-ctrl)', res.paired.rps),
        `c1Version=${res.state.version}`,
      );
    }
    console.log(`\n=== C1 SHADOW REPORT ===\n${lines.join('\n')}\n`);
    expect(chain.ok).toBe(true);
  }, 300000);
});