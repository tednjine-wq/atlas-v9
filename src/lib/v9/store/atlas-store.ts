// ============================================================
// ATLAS v9.3 store — v9.3 links feedback entries to their
// prediction at import time (predictionLabels map + team-name
// match) so BET HISTORY rows can log 1X2 results directly.
// RULES 4/6/7/10.3 preserved.
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

export interface FeedbackEntry {
  id: string; ts: number; matchLabel: string;
  market: string; pick: string; odds: number;
  closingOdds?: number;
  result: 'won' | 'lost' | 'pending';
  matchId?: string; // v9.3: link to prediction for 1X2 logging
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

  addMatch: () => void;
  removeMatch: (id: string) => void;
  updateMatch: (id: string, patch: Partial<Match>) => void;
  updateOdds: (id: string, key: string, value: number) => void;
  setPhi: (v: number) => void;
  recordPrediction: (match: Match, a: AtlasAnalysis) => void;
  submitResult: (id: string, outcome: Outcome) => void;
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

      recordPrediction: (match, a) => {
        const h = parseFloat(match.h), d = parseFloat(match.d), aw = parseFloat(match.a);
        const entryOdds = h > 1 && d > 1 && aw > 1 ? { home: h, draw: d, away: aw } : undefined;
        set((s) => ({
          predictionLabels: { ...s.predictionLabels, [match.id]: `${match.home} v ${match.away}` },
          predictions: [
            ...s.predictions.filter((p) => p.matchId !== match.id),
            {
              id: crypto.randomUUID(), matchId: match.id, gameType: match.gameType,
              pick: a.pick, confidence: a.confidence, probs: { ...a.probs },
              sofTriggered: a.sofTriggered, margin: a.margin, timestamp: Date.now(),
              entryOdds,
            },
          ],
        }));
      },

      submitResult: (id, outcome) => {
        set((s) => ({
          results: { ...s.results, [id]: outcome },
          predictions: s.predictions.map((p) =>
            p.matchId === id && !p.result ? { ...p, result: outcome, resolvedAt: Date.now() } : p),
        }));
        const s1 = get();
        const match = s1.matches.find((m) => m.id === id);
        const pred = s1.predictions.find((p) => p.matchId === id);
        if (match && pred && pred.entryOdds) {
          const closingMap: Record<Outcome, number> = {
            home: parseFloat(match.h), draw: parseFloat(match.d), away: parseFloat(match.a),
          };
          const closing = closingMap[pred.pick];
          const entry = pred.entryOdds[pred.pick];
          if (closing > 1 && entry > 1) {
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
        set({ parlaySim: { ...r, legs: legs.length } });
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

      // v9.3: link feedback → prediction via team-name match
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
          const key = `${e.market}:${e.pick}`;
          const cur = newPosteriors[key] ?? { alpha: 1, beta: 1 };
          newPosteriors[key] = e.result === 'won'
            ? { alpha: cur.alpha + 1, beta: cur.beta }
            : { alpha: cur.alpha, beta: cur.beta + 1 };
        }
        return { feedback: newFeedback, marketPosteriors: newPosteriors };
      }),

      exportSession: () => JSON.stringify({
        version: 'atlas_v9', exportedAt: Date.now(),
        matches: get().matches, results: get().results, phi: get().phi,
        predictions: get().predictions, feedback: get().feedback,
        standardParams: get().standardParams, jackpotParams: get().jackpotParams,
        recalibrationLog: get().recalibrationLog,
        marketPosteriors: get().marketPosteriors,
        predictionLabels: get().predictionLabels,
      }, null, 2),

      importSession: (json) => {
        try {
          const data = JSON.parse(json);
          const sp = data.standardParams?.version === PARAMS_VERSION ? data.standardParams : defaultParams();
          const jp = data.jackpotParams?.version === PARAMS_VERSION ? data.jackpotParams : defaultParams();
          set({
            matches: data.matches ?? [], results: data.results ?? {},
            phi: typeof data.phi === 'number' ? data.phi : 0.10,
            predictions: data.predictions ?? [], feedback: data.feedback ?? [],
            standardParams: sp, jackpotParams: jp,
            recalibrationLog: data.recalibrationLog ?? [],
            marketPosteriors: data.marketPosteriors ?? {},
            predictionLabels: data.predictionLabels ?? {},
          });
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
        if (state && !state.predictionLabels) state.predictionLabels = {};
      },
    },
  ),
);
