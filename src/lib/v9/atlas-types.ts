// ============================================================
// ATLAS v9.6 — types. v9.6 adds mmMarkets provenance to
// CalibrationResult (multi-market lambda blending, §8).
// All v8.7 conventions preserved (Rules 1-7).
// ============================================================

export type Outcome = 'home' | 'draw' | 'away';
export type GameType = 'standard' | 'jackpot';
export type Verdict = 'BET' | 'NO-BET';

export const DC_RHO_STANDARD = -0.13;
export const DC_RHO_JACKPOT = -0.08;
export const PARAMS_VERSION = 4;
export const MIN_RECALIBRATION_RESULTS = 5;

export interface ScoreEntry { s: string; i: number; j: number; p: number; }
export interface MarginWarning { level: 'none' | 'moderate' | 'high' | 'severe'; msg: string; }

export interface PortfolioOutcome {
  outcome: Outcome;
  stake: number; ev: number; sharpe: number; kelly: number;
  isMaxEp: boolean; varPerUnit: number;
}

export interface DecorrelationResult {
  score: number;
  edges: Record<Outcome, number>;
  evs: Record<Outcome, number>;
  spotted: Outcome | null;
  hasRealSpot: boolean;
  maxEdge: number;
}

export interface HybridCalibration {
  source: 'market-only' | 'hybrid';
  marketProbs: [number, number, number];
  priorProbs: [number, number, number] | null;
  blendedProbs: [number, number, number];
  marketPrecision: number;
  priorPrecision: number;
}

export interface CalibrationResult {
  lambdaH: number; lambdaA: number; sse: number; hybrid: HybridCalibration;
  mmMarkets?: number; // v9.6: how many extended prices joined the calibration
}

export type DisagreementLevel = 'none' | 'low' | 'medium' | 'high';
export type SimRecommendation = 'none' | 'shrink_confidence' | 'flip_pick' | 'investigate';

export interface SimResult {
  n: number;
  probs: Record<Outcome, number>;
  ci95: Record<Outcome, number>;
  meanGoals: number; sdGoals: number;
  scoreFreq: ScoreEntry[];
  deltas: Record<Outcome, number>;
  maxDelta: number;
  disagreement: DisagreementLevel;
  recommendation: SimRecommendation;
  confMultiplier: number;
  convergedAt: number;
}

export interface HTFTJoint {
  combos: Record<string, number>;
  theta: number;
  method: 'gaussian-copula-mc';
}

export interface TeamStrengthPrior {
  pHome: number; pDraw: number; pAway: number;
  confidence: number;
}

export interface MatchContext { narrative: string; source: 'ai' | 'rules'; at: number; }

export interface Match {
  id: string;
  home: string; away: string;
  league: string; country: string;
  kickoff: string;
  h: string; d: string; a: string;
  gameType: GameType;
  userOdds: Record<string, number>;
  prior?: TeamStrengthPrior;
  context?: MatchContext;
}

export interface AtlasAnalysis {
  pick: Outcome;
  confidence: number;
  probs: Record<Outcome, number>;
  dcProbs: Record<Outcome, number>;
  bookProbs: Record<Outcome, number>;
  margin: number;
  marginWarning: MarginWarning;
  calibration: CalibrationResult;
  scoreMatrix: ScoreEntry[];
  decorrelation: DecorrelationResult;
  portfolio: PortfolioOutcome[];
  sofTriggered: boolean;
  decorrOverride: boolean;
  thresholdPass: boolean;
  verdict: Verdict;
  tightGame: boolean;
  sim?: SimResult;
  htft?: HTFTJoint;
  engine: GameType;
}

export interface AtlasJackpotAnalysis extends AtlasAnalysis {
  parlayScore: number;
  upsetVulnerable: boolean;
  secondaryPick: Outcome;
  secondaryProb: number;
  homeBias: number;
  skippedDecorrOverride: { wouldFlipTo: Outcome; evLost: number } | null;
}

const KEYS = [
  'bttsYes','bttsNo','over05','under05','over15','under15','over25','under25','over35','under35',
  'exact0','exact1','exact2','exact3','exact4','exact5','exact6plus','oddGoals','evenGoals',
  'group01','group23','group45','group6p','dc1X','dcX2','dc12',
  'ah-1','ah-0.75','ah-0.5','ah-0.25','ah0','ah0.25','ah0.5','ah0.75','ah1',
  'ahht-0.5','ahht-0.25','ahht0',
  'homeOver05','homeUnder05','homeOver15','homeUnder15','homeOver25','homeUnder25',
  'awayOver05','awayUnder05','awayOver15','awayUnder15','awayOver25','awayUnder25',
  'ftsHome','ftsAway','ftsNeither','ht3Home','ht3Draw','ht3Away',
  'bttsHTYes','bttsHTNo','htOver05','htUnder05','htOver15','htUnder15',
  'halfMost1st','halfMost2nd','halfMostNeither',
] as const;

const combo = () => {
  const o: Record<string, number> = {};
  for (const k of KEYS) o[k] = 0;
  for (const cs of ['0_0','1_0','0_1','1_1','2_0','0_2','2_1','1_2','2_2']) o[`cs_${cs}`] = 0;
  for (const h of ['1','X','2']) for (const f of ['1','X','2']) o[`htft_${h}_${f}`] = 0;
  for (const l of ['-1:0','-0:1','0:1','1:0','-2:0','0:2','1:1','2:1','1:2','2:0','0:2']) o[`eh_${l}`] = 0;
  return o;
};

export const EMPTY_USER_ODDS: Readonly<Record<string, number>> = Object.freeze(combo());

export const emptyMatch = (id: string): Match => ({
  id, home: '', away: '', league: '', country: '', kickoff: '',
  h: '', d: '', a: '', gameType: 'standard', userOdds: { ...EMPTY_USER_ODDS },
});
