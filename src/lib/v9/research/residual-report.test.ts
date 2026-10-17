import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { ProspectiveEvent } from '../evidence/prospective-ledger';
import { devigOf, pairedBrierDiff } from './residual-signal';
import type { ResidualRow } from './residual-signal';

const PATH = process.env.PROSPECTIVE_LEDGER_JSON;
const FREEZE_ISO = (() => {
  try { return execSync('git log -1 --format=%cI 2f739f0', { encoding: 'utf8' }).trim(); }
  catch { return '2026-10-17T00:00:00Z'; }
})();

type RowX = ResidualRow & { cohort: 'primary' | 'secondary' };

describe('PATH B gate: residual-signal report (pre-specified lambda=0.5, no grid fishing)', () => {
  const available = !!PATH && existsSync(PATH);
  it.skipIf(!available)('prints paired market-vs-(market+residual) Brier diffs per engine and cohort', () => {
    const events = JSON.parse(readFileSync(PATH!, 'utf8')) as ProspectiveEvent[];
    const freeze = Date.parse(FREEZE_ISO);
    const preds = new Map<string, ProspectiveEvent>();
    for (const e of events) if ((e.type === 'prediction' || e.type === 'backfill') && e.predictionId && e.probs && e.entryOdds) preds.set(e.predictionId, e);
    const rowsAll: RowX[] = [];
    for (const e of events) {
      if (e.type !== 'settlement' || !e.result) continue;
      const p = preds.get(e.predictionId ?? '');
      if (!p || !p.probs || !p.entryOdds) continue;
      rowsAll.push({
        predictionId: e.predictionId!, date: e.resolvedAt ?? e.at, league: p.league ?? undefined, gameType: p.gameType,
        probs: p.probs, devig: devigOf(p.entryOdds.home, p.entryOdds.draw, p.entryOdds.away), outcome: e.result,
        cohort: (p.oddsAt ?? p.at) >= freeze ? 'primary' : 'secondary',
      });
    }
    rowsAll.sort((a, b) => a.date - b.date);
    const line = (tag: string, rs: RowX[]) => {
      const d = pairedBrierDiff(rs);
      return `${tag.padEnd(20)} n=${String(d.n).padEnd(4)} pairedBrierDiff=${d.mean.toFixed(4)} [${d.lo.toFixed(4)},${d.hi.toFixed(4)}]`;
    };
    const sel = (cohort: 'primary' | 'secondary', gt?: string) =>
      rowsAll.filter((r) => r.cohort === cohort && (r.gameType ?? 'standard') === gt);
    console.log(`\n=== RESIDUAL SIGNAL (PATH B GATE) freeze=${FREEZE_ISO} ===\n${line('secondary standard', sel('secondary', 'standard'))}\n${line('secondary jackpot', sel('secondary', 'jackpot'))}\n${line('primary standard', sel('primary', 'standard'))}\n${line('primary jackpot', sel('primary', 'jackpot'))}\n`);
    expect(rowsAll.length).toBeGreaterThanOrEqual(0);
  }, 300000);
});