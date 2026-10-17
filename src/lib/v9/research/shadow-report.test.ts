import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { ProspectiveEvent } from '../evidence/prospective-ledger';
import { runShadow } from './c1-shadow';

const PATH = process.env.PROSPECTIVE_LEDGER_JSON;

describe('C1 shadow report vs frozen control (research-only; promotion requires Phase D gate)', () => {
  const available = !!PATH && existsSync(PATH);
  it.skipIf(!available)('prints paired control-vs-candidate metrics', () => {
    const events = JSON.parse(readFileSync(PATH!, 'utf8')) as ProspectiveEvent[];
    const res = runShadow(events);
    const f = (r: typeof res.control) =>
      `${r.model.padEnd(16)} n=${String(r.n).padEnd(4)} brier=${r.brier.toFixed(4)} [${r.brierCi.lo.toFixed(4)},${r.brierCi.hi.toFixed(4)}] ll=${r.logLoss.toFixed(4)} rps=${r.rps.toFixed(4)}`;
    console.log(`\n=== C1 SHADOW REPORT rows=${res.rows.length} c1Version=${res.state.version} ===\n${f(res.control)}\n${f(res.candidate)}\n`);
    expect(res.control.n).toBe(res.candidate.n);
  }, 300000);
});