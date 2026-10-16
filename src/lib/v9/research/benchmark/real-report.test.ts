import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBenchmark } from './harness';
import type { ModelReport } from './metrics';
import { atlasFrozen, dcIndependent, eloModel, marketDevig, poissonNaive } from './models';
import { loadCsvMatches } from '../datasets';

const DIR = process.env.BENCH_CSV_DIR;
const FILES = ['E0.csv', 'SP1.csv', 'D1.csv', 'I1.csv', 'F1.csv'];
const line = (r: ModelReport) =>
  `${r.model.padEnd(20)} n=${String(r.n).padEnd(5)} brier=${r.brier.toFixed(3)} [${r.brierCi.lo.toFixed(3)},${r.brierCi.hi.toFixed(3)}] ll=${r.logLoss.toFixed(3)} rps=${r.rps.toFixed(3)} acc=${(r.accuracy * 100).toFixed(1)}%`;

describe('real-data benchmark report (historical validation, NOT a clean hold-out)', () => {
  const available = !!DIR && FILES.every((f) => existsSync(join(DIR, f)));
  it.skipIf(!available)('prints the 5-league comparison table', () => {
    const matches = FILES.flatMap((f) => loadCsvMatches(readFileSync(join(DIR!, f), 'utf8'), f.replace('.csv', '')));
    const sorted = [...matches].sort((a, b) => a.date - b.date);
    const c1 = sorted[Math.floor(sorted.length / 3)].date;
    const c2 = sorted[Math.floor((2 * sorted.length) / 3)].date;
    const res = runBenchmark(
      sorted,
      [marketDevig(), poissonNaive(), dcIndependent(), eloModel(), atlasFrozen()],
      { cutoffs: [c1, c2], label: 'real-5leagues' },
      `football-data.co.uk CSVs via BENCH_CSV_DIR: ${FILES.join(', ')}`,
    );
    console.log(`\n=== REAL-DATA BENCHMARK (${res.label}) matches=${sorted.length} burnIn=${res.burnIn} ===\n${res.overall.map(line).join('\n')}\n`);
    expect(res.overall.length).toBe(5);
  }, 600000);
});