// Runs off main thread — UI never freezes (RULE: batch + yield)
import { atlasAnalyseV9 } from '../engines/standard';
import { atlasAnalyseJackpotV9 } from '../engines/jackpot';
import { simulateParlay } from '../math/adaptive-mc';
import { recalibrate } from '../learning/bayesian-learning';
import type { WorkerRequest, WorkerResponse } from './protocol';

const post = (r: WorkerResponse) => (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(r);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'analyse') {
      const t0 = performance.now();
      const result = req.match.gameType === 'jackpot'
        ? atlasAnalyseJackpotV9(req.match, req.phi)
        : atlasAnalyseV9(req.match, req.phi, req.params);
      post({ type: 'analyse-done', id: req.id, result, ms: performance.now() - t0 });
    } else if (req.type === 'analyse-batch') {
      req.matches.forEach((m, i) => {
        const result = m.gameType === 'jackpot'
          ? atlasAnalyseJackpotV9(m, req.phi)
          : atlasAnalyseV9(m, req.phi, req.params);
        post({ type: 'analyse-done', id: req.ids[i], result, ms: 0 });
        post({ type: 'batch-progress', done: i + 1, total: req.matches.length });
      });
    } else if (req.type === 'parlay-sim') {
      post({ type: 'parlay-done', result: simulateParlay(req.legs) });
    } else if (req.type === 'recalibrate') {
      const { params, message } = recalibrate(req.params, req.predictions, req.gameType);
      post({ type: 'recalibrate-done', params, message });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : 'unknown worker error' });
  }
};
