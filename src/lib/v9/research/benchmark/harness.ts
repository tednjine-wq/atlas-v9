// ============================================================
// Reproducible walk-forward benchmark harness.
// Chronology: every match is predicted immediately pre-kickoff
// using only matches resolved strictly earlier; each match is
// scored exactly once, in the window of the latest cutoff that
// precedes it. Matches at/before the first cutoff are burn-in
// (documented, unscored). Windows are reporting groups only.
// Deterministic: no Date.now, no RNG; JSON output byte-stable.
// ============================================================
import type { Outcome } from '../../atlas-types';
import { WINDOW_MS } from '../pipeline';
import type { HistMatch } from '../pipeline';
import { evaluateModel } from './metrics';
import type { ModelReport, ScoredMatch } from './metrics';
import type { BenchModel } from './models';

export interface BenchConfig { cutoffs: number[]; label: string; }
export interface BenchWindow {
  cutoff: number;
  scored: Record<string, ScoredMatch[]>;
  reports: ModelReport[];
}
export interface BenchResult {
  label: string;
  provenance: string;
  config: BenchConfig;
  burnIn: number;
  windows: BenchWindow[];
  overall: ModelReport[];
}

const resultOf = (m: HistMatch): Outcome => (m.hg > m.ag ? 'home' : m.hg === m.ag ? 'draw' : 'away');

export function runBenchmark(matches: HistMatch[], models: BenchModel[], config: BenchConfig, provenance: string): BenchResult {
  const sorted = [...matches].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
  const cutoffs = [...config.cutoffs].sort((a, b) => a - b);
  const windows: BenchWindow[] = cutoffs.map((c) => ({ cutoff: c, scored: {}, reports: [] }));
  for (const w of windows) for (const mo of models) w.scored[mo.name] = [];

  let burnIn = 0;
  let wi = 0;
  for (const m of sorted) {
    while (wi < cutoffs.length && cutoffs[wi] < m.date) wi++;
    if (wi === 0) { burnIn++; for (const mo of models) mo.observe(m); continue; }
    const w = windows[wi - 1];
    for (const mo of models) {
      w.scored[mo.name].push({ id: m.id, date: m.date, probs: mo.predict(m), outcome: resultOf(m) });
    }
    for (const mo of models) mo.observe(m);
  }
  for (const w of windows) w.reports = models.map((mo) => evaluateModel(mo.name, w.scored[mo.name]));
  const overall = models.map((mo) => evaluateModel(mo.name, windows.flatMap((w) => w.scored[mo.name])));
  return { label: config.label, provenance, config, burnIn, windows, overall };
}

export function resultsToJson(r: BenchResult): string {
  return JSON.stringify(r, null, 2);
}

export { WINDOW_MS };