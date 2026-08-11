// Worker message protocol (typed) — off-main-thread pipeline
import type { Match, Outcome, GameType } from '../atlas-types';
import type { LearnedParams, PredictionRecord } from '../learning/bayesian-learning';

export type WorkerRequest =
  | { type: 'analyse'; id: string; match: Match; phi: number; params: LearnedParams }
  | { type: 'analyse-batch'; ids: string[]; matches: Match[]; phi: number; params: LearnedParams }
  | { type: 'parlay-sim'; legs: { lH: number; lA: number; rho: number; pick: Outcome }[] }
  | { type: 'recalibrate'; gameType: GameType; predictions: PredictionRecord[]; params: LearnedParams };

export type WorkerResponse =
  | { type: 'analyse-done'; id: string; result: unknown; ms: number }
  | { type: 'batch-progress'; done: number; total: number }
  | { type: 'parlay-done'; result: unknown }
  | { type: 'recalibrate-done'; params: LearnedParams; message: string }
  | { type: 'error'; message: string };
