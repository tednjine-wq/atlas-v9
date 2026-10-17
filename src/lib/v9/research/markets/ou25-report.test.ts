import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCsvMatchesWithOu } from './ou-data';
import { runOu25 } from './ou25-runner';

const DIR = process.env.BENCH_CSV_DIR;
const FILES = ['E0.csv', 'SP1.csv', 'D1.csv', 'I1.csv', 'F1.csv'];

describe('OU 2.5 benchmark report (R10-mkt; registered primary test, no line fishing)', () => {
  const available = !!DIR && FILES.every((f) => existsSync(join(DIR, f)));
  it.skipIf(!available)('prints reconciliation, paired dBrier CI and the registered verdict', () => {
    const matches = FILES.flatMap((f) => loadCsvMatchesWithOu(readFileSync(join(DIR!, f), 'utf8'), f.replace('.csv', '')));
    const sorted = [...matches].sort((a, b) => a.date - b.date);
    const c1 = sorted[Math.floor(sorted.length / 3)].date;
    const c2 = sorted[Math.floor((2 * sorted.length) / 3)].date;
    const res = runOu25(sorted, [c1, c2]);
    const d = res.dBrier;
    const verdict = d.hi < 0
      ? 'CI entirely below zero: ATLAS superior on this sample — recommend further prospective validation (NOT promotion)'
      : d.lo > 0
        ? 'CI entirely above zero: market baseline superior — close investigation'
        : 'CI includes zero: superiority NOT demonstrated — close under registered rule';
    const cal = res.calibration.map((b) => `  [${b.lo.toFixed(1)},${b.hi.toFixed(1)}) n=${String(b.n).padEnd(4)} pred=${b.meanPred.toFixed(3)} obs=${b.meanObs.toFixed(3)}`).join('\n');
    console.log(`\n=== OU 2.5 BENCHMARK (R10-mkt) ===
reconciliation: total=${res.recon.total} burnIn=${res.recon.burnIn} afterCutoff=${res.recon.afterCutoff} missingOuOdds=${res.recon.missingOuOdds} invalid1x2=${res.recon.invalid1x2} eligible=${res.recon.eligible}
atlas   n=${res.n} brier=${res.atlas.brier.toFixed(4)} ll=${res.atlas.ll.toFixed(4)} acc=${(res.atlas.acc * 100).toFixed(1)}% [${(res.atlas.accCi[0] * 100).toFixed(1)},${(res.atlas.accCi[1] * 100).toFixed(1)}]
market  n=${res.n} brier=${res.market.brier.toFixed(4)} ll=${res.market.ll.toFixed(4)} acc=${(res.market.acc * 100).toFixed(1)}% [${(res.market.accCi[0] * 100).toFixed(1)},${(res.market.accCi[1] * 100).toFixed(1)}]
dBrier(atlas-market)  mean=${d.mean.toFixed(4)} [${d.lo.toFixed(4)},${d.hi.toFixed(4)}]
dLogLoss(atlas-market) mean=${res.dLogLoss.mean.toFixed(4)} [${res.dLogLoss.lo.toFixed(4)},${res.dLogLoss.hi.toFixed(4)}]
calibration (atlas over-prob vs realized over rate):
${cal}
betting: roi=${res.betting ? (res.betting.roi * 100).toFixed(1) + '%' : 'n/a'} pl=${res.betting ? res.betting.pl.toFixed(1) + 'u' : 'n/a'} maxDD=${res.betting ? res.betting.maxDrawdown.toFixed(1) + 'u' : 'n/a'} clv=${res.betting && res.betting.clv !== null ? (res.betting.clv * 100).toFixed(2) + '%' : 'n/a'} (n=${res.betting ? res.betting.clvN : 0})
DECISION: ${verdict}\n`);
    expect(res.n).toBeGreaterThan(0);
  }, 300000);
});