import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { ProspectiveEvent } from '../evidence/prospective-ledger';
import { devigOf, pairedBrierDiff } from './residual-signal';
import type { ResidualRow } from './residual-signal';

const PATH = process.env.PROSPECTIVE_LEDGER_JSON;

describe('PATH B gate: residual-signal report (pre-specified lambda=0.5, no grid fishing)', () => {
  const available = !!PATH && existsSync(PATH);
  it.skipIf(!available)('prints paired market-vs-(market+residual) Brier diffs per engine', () => {
    const events = JSON.parse(readFileSync(PATH!, 'utf8')) as ProspectiveEvent[];
    const preds = new Map<string, ProspectiveEvent>();
    for (const e of events) if ((e.type === 'prediction' || e.type === 'backfill') && e.predictionId && e.probs && e.entryOdds) preds.set(e.predictionId, e);
    const rows: ResidualRow[] = [];
    for (const e of events) {
      if (e.type !== 'settlement' || !e.result) continue;
      const p = preds.get(e.predictionId ?? '');
      if (!p || !p.probs || !p.entryOdds) continue;
      rows.push({
        predictionId: e.predictionId!, date: e.resolvedAt ?? e.at, league: p.league ?? undefined, gameType: p.gameType,
        probs: p.probs, devig: devigOf(p.entryOdds.home, p.entryOdds.draw, p.entryOdds.away), outcome: e.result,
      });
    }
    rows.sort((a, b) => a.date - b.date);
    const byEngine = (gt?: string) => rows.filter((r) => (r.gameType ?? 'standard') === gt);
    const line = (tag: string, rs: ResidualRow[]) => { const d = pairedBrierDiff(rs); return `${tag.padEnd(10)} n=${String(d.n).padEnd(4)} pairedBrierDiff=${d.mean.toFixed(4)} [${d.lo.toFixed(4)},${d.hi.toFixed(4)}]`; };
    console.log(`\n=== RESIDUAL SIGNAL (PATH B GATE) ===\n${line('standard', byEngine('standard'))}\n${line('jackpot', byEngine('jackpot'))}\n`);
    expect(rows.length).toBeGreaterThanOrEqual(0);
  }, 300000);
});