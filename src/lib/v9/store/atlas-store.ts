// ============================================================
// ATLAS v9.6 store — v9.6: snapshotClosing() — re-paste the same
// fixture card ~1h before kickoff; the store diffs entry vs new
// odds per prediction and auto-computes CLV (no manual typing).
// Matches live matches OR stored prediction labels (clear-safe).
// RULES 4/6/7/10.3 preserved.
// v9.10 Phase B2: prospective-evidence integrity — late stamp,
// same-day dedupe (visible counter), schema-v2 export/import
// with ledger. Prediction/staking math untouched.
// ============================================================
'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  emptyMatch, DC_RHO_STANDARD, DC_RHO_JACKPOT, PARAMS_VERSION, MIN_RECALIBRATION_RESULTS,
} from '../atlas-types';
import type { Match, Outcome, GameType, SimResult, AtlasAnalysis } from '../atlas-types';
import type { LearnedParams, PredictionRecord } from '../learning/bayesian-learning';
import { defaultParams, recalibrate } from '../learning/bayesian-learning';
import { calibrateLambda } from '../math/calibration';
import { buildScoreMatrix, outcomeProbs } from '../math/dixon-coles';
import { adaptiveSimulate, simulateParlay } from '../math/adaptive-mc';
import { atlasAnalyseJackpotV9 } from '../engines/jackpot';
import { idbGet, idbSet } from '../storage/idb';
import {
  EVIDENCE_SCHEMA_VERSION, dedupeKey, isLatePrediction, parseEvidence,
} from '../evidence/evidence-schema';
import { appendLedger, clearLedger, loadLedger } from '../analysis/lab-ledger';

export interface FeedbackEntry {
  id: string; ts: number; matchLabel: string;
  market: string; pick: string; odds: number;
  closingOdds?: number;
  result: 'won' | 'lost' | 'pending';
  matchId?: string;
}
export interface ApiPick {
  id: string; home: string; away: string; league: string; kickoff: string;
  h: string; d: string; a: string; bookmakers: number; valueGap: number;
}
export interface ParlaySimResult {
  allCorrect: number; legProbs: number[]; expectedCorrect: number;
  distribution: number[]; cumulative: Record<number, number>; legs: number;
}
export interface RecalLogEntry { at: number; gameType: GameType; message: string; }

export interface MarketPosterior { alpha: number; beta: number; }
export type MarketPosteriors = Record<string, MarketPosterior>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

interface AtlasState {
  matches: Match[];
  results: Record<string, Outcome>;
  feedback: FeedbackEntry[];
  phi: number;
  predictions: PredictionRecord[];
  standardParams: LearnedParams;
  jackpotParams: LearnedParams;
  simResults: Record<string, SimResult>;
  parlaySim: ParlaySimResult | null;
  recalibrationLog: RecalLogEntry[];
  apiPicks: ApiPick[]; apiPicksLoading: boolean; apiPicksError: string | null;
  simsRunning: boolean;
  marketPosteriors: MarketPosteriors;
  predictionLabels: Record<string, string>;
  duplicateSkips: number;

  addMatch: () => void;
  removeMatch: (id: string) => void;
  updateMatch: (id: string, patch: Partial<Match>) => void;
  updateOdds: (id: string, key: string, value: number) => void;
  setPhi: (v: number) => void;
  recordPrediction: (match: Match, a: AtlasAnalysis) => void;
  submitResult: (id: string, outcome: Outcome, closingOverride?: number) => void;
  snapshotClosing: (fx: { home: string; away: string; h: string; d: string; a: string }[]) => number;
  forceRecalibrate: (gameType: GameType) => void;
  clearLearningData: () => void;
  runAllSims: () => Promise<void>;
  runParlaySim: () => void;
  fetchApiPicks: () => Promise<void>;
  importApiPicks: () => void;
  addFeedback: (e: Omit<FeedbackEntry, 'id' | 'ts'>) => void;
  exportSession: () => string;
  importSession: (json: string) => boolean;
}

const idbStorage = {
  getItem: async (name: string) => {
    if (typeof indexedDB === 'undefined') return null;
    return (await idbGet<string>(name)) ?? null;
  },
  setItem: async (name: string, value: string) => {
    if (typeof indexedDB === 'undefined') return;
    await idbSet(name, value);
  },
  removeItem: async (name: string) => {
    if (typeof indexedDB === 'undefined') return;
    await idbSet(name, null);
  },
};

export const useAtlasStore = create<AtlasState>()(
  persist(
    (set, get) => ({
      matches: [], results: {}, feedback: [], phi: 0.10,
      predictions: [],
      standardParams: defaultParams(), jackpotParams: defaultParams(),
      simResults: {}, parlaySim: null, recalibrationLog: [],
      apiPicks: [], apiPicksLoading: false, apiPicksError: null,
      simsRunning: false,
      marketPosteriors: {},
      predictionLabels: {},
      duplicateSkips: 0,

      addMatch: () => set((s) => ({ matches: [...s.matches, emptyMatch(crypto.randomUUID())] })),
      removeMatch: (id) => set((s) => ({ matches: s.matches.filter((m) => m.id !== id) })),
      updateMatch: (id, patch) => set((s) => ({
        matches: s.matches.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
      updateOdds: (id, key, value) => set((s) => ({
        matches: s.matches.map((m) => (m.id === id
          ? { ...m, userOdds: { ...m.userOdds, [key]: value } } : m)),
      })),
      setPhi: (v) => set({ phi: v }),

      // B2: stamp evidence-integrity fields; block same-day duplicate
      // fixtures arriving under a different match id (re-paste flows
      // update via snapshotClosing instead, preserving entry odds).
      recordPrediction: (match, a) => {
        const h = parseFloat(match.h), d = parseFloat(match.d), aw = parseFloat(match.a);
        const entryOdds = h > 1 && d > 1 && aw > 1 ? { home: h, draw: d, away: aw } : undefined;
        const now = Date.now();
        const evKey = dedupeKey({
          home: match.home, away: match.away, league: match.league,
          gameType: match.gameType, timestamp: now,
        });
        const late = isLatePrediction(now, match.kickoff);
        const dup = get().predictions.some((p) => p.matchId !== match.id
          && (p as PredictionRecord & { evKey?: string }).evKey === evKey);
        if (dup) { set((s) => ({ duplicateSkips: s.duplicateSkips + 1 })); return; }
        set((s) => ({
          predictionLabels: { ...s.predictionLabels, [match.id]: `${match.home} v ${match.away}` },
          predictions: [
            ...s.predictions.filter((p) => p.matchId !== match.id),
            {
              id: crypto.randomUUID(), matchId: match.id, gameType: match.gameType,
              pick: a.pick, confidence: a.confidence, probs: { ...a.probs },
              sofTriggered: a.sofTriggered, margin: a.margin, timestamp: now,
              entryOdds, label: `${match.home} v ${match.away}`, evKey, late,
            } as PredictionRecord,
          ],
        }));
      },

      submitResult: (id, outcome, closingOverride) => {
        set((s) => ({
          results: { ...s.results, [id]: outcome },
          predictions: s.predictions.map((p) =>
            p.matchId === id && !p.result ? { ...p, result: outcome, resolvedAt: Date.now() } : p),
        }));
        const s1 = get();
        const match = s1.matches.find((m) => m.id === id);
        const pred = s1.predictions.find((p) => p.matchId === id);
        if (pred && pred.entryOdds) {
          const entry = pred.entryOdds[pred.pick];
          let closing = NaN;
          if (closingOverride && closingOverride > 1) closing = closingOverride;
          else if (match) {
            closing = pred.pick === 'home' ? parseFloat(match.h)
              : pred.pick === 'draw' ? parseFloat(match.d)
              : parseFloat(match.a);
          }
          if (entry > 1 && closing > 1) {
            const clv = entry / closing - 1;
            set((st) => ({
              predictions: st.predictions.map((p) =>
                p.matchId === id ? { ...p, closingOdds: closing, clv } : p),
            }));
          }
        }
        const s2 = get();
        const pred2 = s2.predictions.find((p) => p.matchId === id);
        if (!pred2) return;
        const n = s2.predictions.filter((p) => p.gameType === pred2.gameType && p.result).length;
        if (n >= MIN_RECALIBRATION_RESULTS && n % MIN_RECALIBRATION_RESULTS === 0)
          get().forceRecalibrate(pred2.gameType);
      },

      // v9.6: re-paste the same card pre-kickoff → auto CLV
      snapshotClosing: (fx) => {
        let n = 0;
        set((s) => {
          const predictions = [...s.predictions];
          for (const f of fx) {
            const core = norm(`${f.home} v ${f.away}`);
            let matchId = s.matches.find((m) => norm(`${m.home} v ${m.away}`) === core)?.id;
            if (!matchId) {
              const hit = Object.entries(s.predictionLabels).find(([, lbl]) => norm(lbl) === core);
              if (hit) matchId = hit[0];
            }
            if (!matchId) continue;
            const idx = predictions.findIndex((p) => p.matchId === matchId && p.entryOdds && !p.result);
            if (idx < 0) continue;
            const p = predictions[idx];
            const eo = p.entryOdds;
            if (!eo) continue;
            const closingRaw = p.pick === 'home' ? f.h : p.pick === 'draw' ? f.d : f.a;
            const closing = parseFloat(closingRaw);
            const entry = eo[p.pick];
            if (!(closing > 1) || !(entry > 1)) continue;
            predictions[idx] = { ...p, closingOdds: closing, clv: entry / closing - 1 };
            n++;
          }
          return { predictions };
        });
        return n;
      },

      forceRecalibrate: (gameType) => {
        const s = get();
        const params = gameType === 'standard' ? s.standardParams : s.jackpotParams;
        const { params: np, message } = recalibrate(params, s.predictions, gameType);
        set(gameType === 'standard' ? { standardParams: np } : { jackpotParams: np });
        set((st) => ({ recalibrationLog: [...st.recalibrationLog, { at: Date.now(), gameType, message }] }));
      },

      clearLearningData: () => set({
        predictions: [], recalibrationLog: [], marketPosteriors: {},
        standardParams: defaultParams(), jackpotParams: defaultParams(),
      }),

      runAllSims: async () => {
        set({ simsRunning: true });
        for (const m of get().matches) {
          const h = parseFloat(m.h), d = parseFloat(m.d), a = parseFloat(m.a);
          if (h > 1 && d > 1 && a > 1) {
            const rho = m.gameType === 'jackpot' ? DC_RHO_JACKPOT : DC_RHO_STANDARD;
            const cal = calibrateLambda(h, d, a, rho, m.prior);
            const sm = buildScoreMatrix(cal.lambdaH, cal.lambdaA, rho);
            const grid = outcomeProbs(sm.raw, sm.sum);
            const sim = adaptiveSimulate(cal.lambdaH, cal.lambdaA, rho, { gridProbs: grid });
            set((s) => ({ simResults: { ...s.simResults, [m.id]: sim } }));
          }
          await new Promise((r) => setTimeout(r, 0));
        }
        set({ simsRunning: false });
      },

      runParlaySim: () => {
        const legs = get().matches
          .filter((m) => m.gameType === 'jackpot' &&
            parseFloat(m.h) > 1 && parseFloat(m.d) > 1 && parseFloat(m.a) > 1)
          .map((m) => {
            const a = atlasAnalyseJackpotV9(m, get().phi);
            return { lH: a.calibration.lambdaH, lA: a.calibration.lambdaA, rho: DC_RHO_JACKPOT, pick: a.pick };
          });
        if (!legs.length) return;
        const r = simulateParlay(legs);
        set((parlaySim => ({ parlaySim: { ...r, legs: legs.length } }))());
      },

      fetchApiPicks: async () => {
        set({ apiPicksLoading: true, apiPicksError: null });
        try {
          const res = await fetch('/api/daily-picks');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          set({ apiPicks: data.picks ?? [], apiPicksLoading: false });
        } catch (e) {
          set({ apiPicksLoading: false, apiPicksError: e instanceof Error ? e.message : 'fetch failed' });
        }
      },

      importApiPicks: () => {
        const picks = get().apiPicks;
        const newMatches: Match[] = picks.map((p) => ({
          ...emptyMatch(p.id ?? crypto.randomUUID()),
          home: p.home, away: p.away, league: p.league, kickoff: p.kickoff,
          h: p.h, d: p.d, a: p.a,
          gameType: picks.length >= 10 ? 'jackpot' : 'standard',
        }));
        set((s) => ({ matches: [...s.matches, ...newMatches], apiPicks: [] }));
      },

      addFeedback: (e) => set((s) => {
        const labelCore = norm(e.matchLabel.split('·')[0]);
        let linkId: string | undefined;
        const live = s.matches.find((m) => norm(`${m.home} v ${m.away}`) === labelCore);
        if (live) linkId = live.id;
        else {
          const hit = Object.entries(s.predictionLabels).find(([, lbl]) => norm(lbl) === labelCore);
          if (hit) linkId = hit[0];
        }
        const newFeedback = [...s.feedback, { ...e, matchId: linkId, id: crypto.randomUUID(), ts: Date.now() }];
        const newPosteriors = { ...s.marketPosteriors };
        if (e.result === 'won' || e.result === 'lost') {
          const key = `${e.market}:${e.pick.trim().toUpperCase()}`;
          const cur = newPosteriors[key] ?? { alpha: 1, beta: 1 };
          newPosteriors[key] = e.result === 'won'
            ? { alpha: cur.alpha + 1, beta: cur.beta }
            : { alpha: cur.alpha, beta: cur.beta + 1 };
        }
        return { feedback: newFeedback, marketPosteriors: newPosteriors };
      }),

      // B2: schema-v2 envelope (ledger included); all legacy fields kept
      exportSession: () => JSON.stringify({
        version: 'atlas_v9', schemaVersion: EVIDENCE_SCHEMA_VERSION, exportedAt: Date.now(),
        matches: get().matches, results: get().results, phi: get().phi,
        predictions: get().predictions, feedback: get().feedback,
        standardParams: get().standardParams, jackpotParams: get().jackpotParams,
        recalibrationLog: get().recalibrationLog,
        marketPosteriors: get().marketPosteriors,
        predictionLabels: get().predictionLabels,
        ledger: loadLedger(),
      }, null, 2),

      // B2: predictions validated/migrated through parseEvidence; ledger
      // restored only into an empty local ledger (never clobbers evidence)
      importSession: (json) => {
        try {
          const data = JSON.parse(json);
          const sp = data.standardParams?.version === PARAMS_VERSION ? data.standardParams : defaultParams();
          const jp = data.jackpotParams?.version === PARAMS_VERSION ? data.jackpotParams : defaultParams();
          const parsed = parseEvidence(json);
          const preds = parsed.ok && parsed.data ? parsed.data.predictions : (data.predictions ?? []);
          set({
            matches: data.matches ?? [], results: data.results ?? {},
            phi: typeof data.phi === 'number' ? data.phi : 0.10,
            predictions: preds, feedback: data.feedback ?? [],
            standardParams: sp, jackpotParams: jp,
            recalibrationLog: data.recalibrationLog ?? [],
            marketPosteriors: data.marketPosteriors ?? {},
            predictionLabels: data.predictionLabels ?? {},
          });
          if (parsed.ok && parsed.data && parsed.data.ledger.length && !loadLedger().length) {
            clearLedger();
            appendLedger(parsed.data.ledger);
          }
          return true;
        } catch { return false; }
      },
    }),
    {
      name: 'atlas_v9_store',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({
        matches: s.matches, results: s.results, feedback: s.feedback, phi: s.phi,
        predictions: s.predictions, standardParams: s.standardParams,
        jackpotParams: s.jackpotParams, recalibrationLog: s.recalibrationLog,
        marketPosteriors: s.marketPosteriors, predictionLabels: s.predictionLabels,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.standardParams.version !== PARAMS_VERSION) state.standardParams = defaultParams();
        if (state && state.jackpotParams.version !== PARAMS_VERSION) state.jackpotParams = defaultParams();
        if (state && !state.marketPosteriors) state.marketPosteriors = {};
        if (state && state.marketPosteriors) {
          const merged: Record<string, { alpha: number; beta: number }> = {};
          for (const [k, v] of Object.entries(state.marketPosteriors)) {
            const i = k.indexOf(':');
            const nk = `${k.slice(0, i)}:${k.slice(i + 1).trim().toUpperCase()}`;
            const cur = merged[nk] ?? { alpha: 1, beta: 1 };
            cur.alpha += v.alpha - 1;
            cur.beta += v.beta - 1;
            merged[nk] = cur;
          }
          state.marketPosteriors = merged;
        }
        if (state && !state.predictionLabels) state.predictionLabels = {};
      },
    },
  ),
);