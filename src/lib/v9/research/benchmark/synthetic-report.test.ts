import { describe, expect, it } from 'vitest';
import { runBenchmark, resultsToJson } from './harness';
import type { ModelReport } from './metrics';
import { atlasFrozen, dcIndependent, eloModel, marketDevig, poissonNaive } from './models';
import { syntheticHistory } from '../datasets';

const CFG = { cutoffs: [Date.parse('2023-08-01T00:00:00Z'), Date.parse('2024-07-01T00:00:00Z')], label: 'synthetic-report' };
const PROV = 'synthetic: mulberry32(7), 4 teams x 3 seasons, 10-day spacing';
const line = (r: ModelReport) =>
  `${r.model.padEnd(20)} n=${String(r.n).padEnd(4)} brier=${r.brier.toFixed(3)} [${r.brierCi.lo.toFixed(3)},${r.brierCi.hi.toFixed(3)}] ll=${r.logLoss.toFixed(3)} rps=${r.rps.toFixed(3)} acc=${(r.accuracy * 100).toFixed(1)}%`;

describe('synthetic benchmark report (generator; NOT evidence of real improvement)', () => {
  it('prints the overall comparison table', () => {
    const res = runBenchmark(syntheticHistory(), [marketDevig(), poissonNaive(), dcIndependent(), eloModel(), atlasFrozen()], CFG, PROV);
    console.log(`\n=== SYNTHETIC BENCHMARK (${res.label}) burnIn=${res.burnIn} ===\n${res.overall.map(line).join('\n')}\n`);
    expect(res.overall.length).toBe(5);
    expect(resultsToJson(res).length).toBeGreaterThan(100);
  });
});