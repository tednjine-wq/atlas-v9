// ============================================================
// Extended Markets Engine v9.3 — v9.2 groups + EV ANOMALY GATE.
// An attached price is an anomaly (data error) when its EV > +40%
// or its implied prob < 35% of the model prob. Anomalies get
// ev = 0 (grey display) and are excluded from topEvBets/slates.
// Audit fixes preserved: BTTS = DC-corrected sum; AH quarter-line
// push rule; home covers when margin > -line.
// ============================================================
import { buildScoreMatrix, outcomeProbs } from '../math/dixon-coles';
import { poisson } from '../math/poisson';
import { htftCopulaJoint } from '../math/copula';
import type { ScoreEntry } from '../atlas-types';

export interface ExtendedMarketItem {
  key: string; label: string; prob: number;
  odds: number; ev: number; group: string; anomaly: boolean;
}
export interface MarketGroup { name: string; items: ExtendedMarketItem[]; }
export interface ExtendedMarkets {
  groups: MarketGroup[];
  topEvBets: ExtendedMarketItem[];
  flat: Record<string, number>;
  pHome: number; pDraw: number; pAway: number;
  pBttsYes: number; pOver25: number; p1X: number;
  htft: Record<string, number>;
}

const makeAH = (diff: Map<number, number>) => {
  const gt = (t: number) => { let s = 0; diff.forEach((p, d) => { if (d > t) s += p; }); return s; };
  const lt = (t: number) => { let s = 0; diff.forEach((p, d) => { if (d < t) s += p; }); return s; };
  const eq = (t: number) => diff.get(t) ?? 0;
  const side = (M: number, dir: 'gt' | 'lt') => {
    const P = dir === 'gt' ? gt : lt;
    if (Number.isInteger(M)) return P(M) + 0.5 * eq(M);
    if (Math.abs(Math.abs(M) % 1 - 0.5) < 1e-9) return P(M);
    const I = Math.round(M);
    return P(I) + 0.5 * eq(I);
  };
  return { home: (L: number) => side(-L, 'gt'), away: (L: number) => side(-L, 'lt') };
};

export function htftJointExact(lH: number, lA: number, rho: number, theta = 0.65): Record<string, number> {
  const fs = buildScoreMatrix(lH, lA, rho);
  const ft = outcomeProbs(fs.raw, fs.sum);
  const hs = buildScoreMatrix(lH / 2, lA / 2, rho);
  const ht = outcomeProbs(hs.raw, hs.sum);
  const mc = htftCopulaJoint(lH, lA, rho, theta, 20000, 7).combos;
  const K = ['1', 'X', '2'];
  const M = K.map((hk) => K.map((fk) => Math.max(mc[`${hk}_${fk}`] ?? 0.01, 1e-9)));
  const rowT = [ht.home, ht.draw, ht.away];
  const colT = [ft.home, ft.draw, ft.away];
  for (let it = 0; it < 30; it++) {
    for (let r = 0; r < 3; r++) {
      const s = M[r][0] + M[r][1] + M[r][2];
      for (let c = 0; c < 3; c++) M[r][c] *= rowT[r] / s;
    }
    for (let c = 0; c < 3; c++) {
      const s = M[0][c] + M[1][c] + M[2][c];
      for (let r = 0; r < 3; r++) M[r][c] *= colT[c] / s;
    }
  }
  const out: Record<string, number> = {};
  K.forEach((hk, r) => K.forEach((fk, c) => { out[`${hk}_${fk}`] = M[r][c]; }));
  return out;
}

export function computeExtendedMarketsV9(
  matrix: ScoreEntry[], lH: number, lA: number, rho: number,
  userOdds: Record<string, number>,
): ExtendedMarkets {
  const P: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
  for (const e of matrix) P[e.i][e.j] = e.p;
  const flat: Record<string, number> = {};
  const groups: MarketGroup[] = [];

  const sumWhere = (f: (i: number, j: number) => boolean) => {
    let s = 0;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (f(i, j)) s += P[i][j];
    return s;
  };

  // v9.3 anomaly gate: garbage odds can never fabricate +EV again
  const mk = (key: string, label: string, prob: number, group: string): ExtendedMarketItem => {
    const odds = userOdds[key] && userOdds[key] > 1 ? userOdds[key] : 0;
    const rawEv = odds > 1 ? prob * odds - 1 : 0;
    const implied = odds > 1 ? 1 / odds : 0;
    const anomaly = odds > 1 && (rawEv > 0.40 || (prob > 0.05 && implied < 0.35 * prob));
    const item = { key, label, prob, odds, ev: anomaly ? 0 : rawEv, group, anomaly };
    flat[key] = prob;
    return item;
  };

  const diffM = new Map<number, number>();
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++)
    diffM.set(i - j, (diffM.get(i - j) ?? 0) + P[i][j]);
  const ahFT = makeAH(diffM);

  const pHome = sumWhere((i, j) => i > j);
  const pDraw = sumWhere((i, j) => i === j);
  const pAway = 1 - pHome - pDraw;

  const pBttsYes = sumWhere((i, j) => i > 0 && j > 0);
  groups.push({ name: 'BTTS', items: [
    mk('bttsYes', 'BTTS: Yes', pBttsYes, 'BTTS'),
    mk('bttsNo', 'BTTS: No', 1 - pBttsYes, 'BTTS'),
  ]});

  const ouItems: ExtendedMarketItem[] = [];
  for (const line of [0.5, 1.5, 2.5, 3.5]) {
    const over = sumWhere((i, j) => i + j > line);
    const lk = String(line).replace('.', '');
    ouItems.push(mk(`over${lk}`, `Over ${line}`, over, 'O/U FT'));
    ouItems.push(mk(`under${lk}`, `Under ${line}`, 1 - over, 'O/U FT'));
  }
  groups.push({ name: 'Over/Under FT', items: ouItems });

  const exItems: ExtendedMarketItem[] = [];
  for (let n = 0; n <= 5; n++)
    exItems.push(mk(`exact${n}`, `Exactly ${n} goals`, sumWhere((i, j) => i + j === n), 'Exact Goals'));
  exItems.push(mk('exact6plus', '6+ goals', sumWhere((i, j) => i + j >= 6), 'Exact Goals'));
  groups.push({ name: 'Exact Goals', items: exItems });

  const pOdd = sumWhere((i, j) => (i + j) % 2 === 1);
  groups.push({ name: 'Odd/Even', items: [
    mk('oddGoals', 'Odd total goals', pOdd, 'Odd/Even'),
    mk('evenGoals', 'Even total goals', 1 - pOdd, 'Odd/Even'),
  ]});

  const range = (lo: number, hi: number) => sumWhere((i, j) => i + j >= lo && i + j <= hi);
  groups.push({ name: 'Goal Groups', items: [
    mk('group01', '0-1 goals', range(0, 1), 'Goal Groups'),
    mk('group23', '2-3 goals', range(2, 3), 'Goal Groups'),
    mk('group45', '4-5 goals', range(4, 5), 'Goal Groups'),
    mk('group6p', '6+ goals', sumWhere((i, j) => i + j >= 6), 'Goal Groups'),
  ]});

  const p1X = pHome + pDraw;
  groups.push({ name: 'Double Chance', items: [
    mk('dc1X', '1X (Home or Draw)', p1X, 'Double Chance'),
    mk('dcX2', 'X2 (Draw or Away)', pDraw + pAway, 'Double Chance'),
    mk('dc12', '12 (Home or Away)', pHome + pAway, 'Double Chance'),
  ]});

  const ahLines = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  const ahItems: ExtendedMarketItem[] = [];
  for (const L of ahLines) {
    ahItems.push(mk(`ah${L}`, `AH Home ${L > 0 ? '+' : ''}${L}`, ahFT.home(L), 'Asian Handicap FT'));
    ahItems.push(mk(`ah${L}_a`, `AH Away ${-L > 0 ? '+' : ''}${-L}`, ahFT.away(L), 'Asian Handicap FT'));
  }
  groups.push({ name: 'Asian Handicap FT', items: ahItems });

  const hts = buildScoreMatrix(lH / 2, lA / 2, rho);
  const htp: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
  for (const e of hts.matrix) htp[e.i][e.j] = e.p;
  const htSumWhere = (f: (i: number, j: number) => boolean) => {
    let s = 0;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (f(i, j)) s += htp[i][j];
    return s;
  };
  const ht3 = outcomeProbs(hts.raw, hts.sum);
  const htDiff = new Map<number, number>();
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++)
    htDiff.set(i - j, (htDiff.get(i - j) ?? 0) + htp[i][j]);
  const ahHT = makeAH(htDiff);

  groups.push({ name: 'Asian Handicap HT', items: [
    mk('ahht-0.5', 'AH HT Home -0.5', ahHT.home(-0.5), 'Asian Handicap HT'),
    mk('ahht-0.25', 'AH HT Home -0.25', ahHT.home(-0.25), 'Asian Handicap HT'),
    mk('ahht0', 'AH HT Home 0', ahHT.home(0), 'Asian Handicap HT'),
  ]});

  const htTotGt = (t: number) => htSumWhere((i, j) => i + j > t);
  const htTotEq = (t: number) => htSumWhere((i, j) => i + j === t);
  const over100 = htTotGt(1) + 0.5 * htTotEq(1);
  const over075 = 0.5 * htTotGt(0.5) + 0.5 * over100;
  groups.push({ name: 'Asian Total Goals HT', items: [
    mk('athtOver075', 'HT Over 0.75', over075, 'Asian Total Goals HT'),
    mk('athtUnder075', 'HT Under 0.75', 1 - over075, 'Asian Total Goals HT'),
    mk('athtOver100', 'HT Over 1.00', over100, 'Asian Total Goals HT'),
    mk('athtUnder100', 'HT Under 1.00', 1 - over100, 'Asian Total Goals HT'),
    mk('htOver05', 'HT Over 0.5', htTotGt(0.5), 'Asian Total Goals HT'),
    mk('htUnder05', 'HT Under 0.5', 1 - htTotGt(0.5), 'Asian Total Goals HT'),
    mk('htOver15', 'HT Over 1.5', htTotGt(1.5), 'Asian Total Goals HT'),
    mk('htUnder15', 'HT Under 1.5', 1 - htTotGt(1.5), 'Asian Total Goals HT'),
  ]});

  const teamItems: ExtendedMarketItem[] = [];
  for (const side of ['home', 'away'] as const) {
    for (const line of [0.5, 1.5, 2.5]) {
      let over = 0;
      for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
        const g = side === 'home' ? i : j;
        if (g > line) over += P[i][j];
      }
      const lk = String(line).replace('.', '');
      teamItems.push(mk(`${side}Over${lk}`, `${side === 'home' ? 'Home' : 'Away'} Over ${line}`, over, 'Team Goals'));
      teamItems.push(mk(`${side}Under${lk}`, `${side === 'home' ? 'Home' : 'Away'} Under ${line}`, 1 - over, 'Team Goals'));
    }
  }
  groups.push({ name: 'Team Goals O/U', items: teamItems });

  const pNeither = P[0][0];
  const pFtsH = (lH / (lH + lA)) * (1 - pNeither);
  const pFtsA = 1 - pNeither - pFtsH;
  groups.push({ name: 'First To Score', items: [
    mk('ftsHome', 'Home scores first', pFtsH, 'First To Score'),
    mk('ftsAway', 'Away scores first', pFtsA, 'First To Score'),
    mk('ftsNeither', 'Neither scores', pNeither, 'First To Score'),
  ]});

  groups.push({ name: 'Half Time 3-Way', items: [
    mk('ht3Home', 'Home leading at HT', ht3.home, 'Half Time 3-Way'),
    mk('ht3Draw', 'Draw at HT', ht3.draw, 'Half Time 3-Way'),
    mk('ht3Away', 'Away leading at HT', ht3.away, 'Half Time 3-Way'),
  ]});

  const pBttsHT = htSumWhere((i, j) => i > 0 && j > 0);
  groups.push({ name: 'BTTS Half Time', items: [
    mk('bttsHTYes', 'BTTS at HT: Yes', pBttsHT, 'BTTS Half Time'),
    mk('bttsHTNo', 'BTTS at HT: No', 1 - pBttsHT, 'BTTS Half Time'),
  ]});

  const m = (lH + lA) / 2;
  let p1st = 0, pNeitherHalf = 0;
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) {
    const pj = poisson(a, m) * poisson(b, m);
    if (a > b) p1st += pj; else if (a === b) pNeitherHalf += pj;
  }
  groups.push({ name: 'Half With Most Goals', items: [
    mk('halfMost1st', '1st half', p1st, 'Half With Most Goals'),
    mk('halfMost2nd', '2nd half', 1 - p1st - pNeitherHalf, 'Half With Most Goals'),
    mk('halfMostNeither', 'Equal', pNeitherHalf, 'Half With Most Goals'),
  ]});

  const htft = htftJointExact(lH, lA, rho);
  groups.push({ name: 'HT/FT Double Result', items: Object.entries(htft)
    .map(([k, prob]) => mk(`htft_${k}`, `HT/FT ${k.replace('_', '/')}`, prob, 'HT/FT'))
    .sort((a, b) => b.prob - a.prob) });

  const ehBase = ['-1:0', '0:1', '1:0', '0:-1', '-2:0', '0:2', '1:1', '2:1', '1:2', '2:0', '0:-2'];
  const ehSet = new Map<string, { h: number; a: number }>();
  for (const k of Object.keys(userOdds)) {
    const mm = k.match(/^eh_(-?\d+):(-?\d+)_[1X2]$/);
    if (mm && userOdds[k] > 1) ehSet.set(`${mm[1]}:${mm[2]}`, { h: +mm[1], a: +mm[2] });
  }
  const ehLines = [...new Set([...ehBase, ...ehSet.keys()])];
  const ehItems: ExtendedMarketItem[] = [];
  for (const line of ehLines) {
    const rec = ehSet.get(line);
    const adjH = rec ? rec.h : parseFloat(line.split(':')[0]);
    const adjA = rec ? rec.a : parseFloat(line.split(':')[1]);
    let ph = 0, pd = 0, pa = 0;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
      const vh = i + adjH, va = j + adjA;
      if (vh > va) ph += P[i][j]; else if (vh === va) pd += P[i][j]; else pa += P[i][j];
    }
    ehItems.push(mk(`eh_${line}_1`, `EH ${line}: Home`, ph, 'Euro Handicap'));
    ehItems.push(mk(`eh_${line}_X`, `EH ${line}: Draw`, pd, 'Euro Handicap'));
    ehItems.push(mk(`eh_${line}_2`, `EH ${line}: Away`, pa, 'Euro Handicap'));
  }
  groups.push({ name: 'Euro Handicap', items: ehItems });

  const csItems = [...matrix].slice(0, 8).map((e) =>
    mk(`cs_${e.i}_${e.j}`, `Score ${e.i}-${e.j}`, e.p, 'Correct Score'));
  csItems.push(mk('cs_any', 'Any Other', 1 - sumWhere((i, j) => i <= 6 && j <= 6), 'Correct Score'));
  groups.push({ name: 'Correct Score', items: csItems });

  const htcsItems: ExtendedMarketItem[] = [];
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++)
    htcsItems.push(mk(`htcs_${i}_${j}`, `HT ${i}-${j}`, htp[i][j], 'HT Correct Score'));
  let htListed = 0;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) htListed += htp[i][j];
  htcsItems.push(mk('htcs_any', 'HT Any Other', 1 - htListed, 'HT Correct Score'));
  htcsItems.sort((a, b) => b.prob - a.prob);
  groups.push({ name: 'Correct Score - First Half', items: htcsItems });

  const ftrOf = (i: number, j: number) => (i > j ? '1' : i === j ? 'X' : '2');
  const ftrOUItems: ExtendedMarketItem[] = [];
  for (const ftr of ['1', 'X', '2']) {
    for (const [lk, line, over] of [['O15', 1.5, true], ['U15', 1.5, false], ['O25', 2.5, true], ['U25', 2.5, false]] as const) {
      const p = sumWhere((i, j) => ftrOf(i, j) === ftr && (i + j > line) === over);
      ftrOUItems.push(mk(`ftrOU_${ftr}_${lk}`, `${ftr} & ${over ? 'Over' : 'Under'} ${line}`, p, 'FTR + O/U'));
    }
  }
  groups.push({ name: 'FTR + Over/Under', items: ftrOUItems });

  const ftrBTTSItems: ExtendedMarketItem[] = [];
  for (const ftr of ['1', 'X', '2']) {
    for (const [bk, yes] of [['Yes', true], ['No', false]] as const) {
      const p = sumWhere((i, j) => ftrOf(i, j) === ftr && (i > 0 && j > 0) === yes);
      ftrBTTSItems.push(mk(`ftrBTTS_${ftr}_${bk}`, `${ftr} & BTTS ${yes ? 'Yes' : 'No'}`, p, 'FTR + BTTS'));
    }
  }
  groups.push({ name: 'FTR + BTTS', items: ftrBTTSItems });

  groups.push({ name: 'Clean Sheet', items: [
    mk('csHome', 'Home clean sheet', sumWhere((_i, j) => j === 0), 'Clean Sheet'),
    mk('csAway', 'Away clean sheet', sumWhere((i) => i === 0), 'Clean Sheet'),
  ]});

  const wm = (d: number) => sumWhere((i, j) => i - j === d);
  groups.push({ name: 'Winning Margin', items: [
    mk('wmH1', 'Home by 1', wm(1), 'Winning Margin'),
    mk('wmH2', 'Home by 2', wm(2), 'Winning Margin'),
    mk('wmH3', 'Home by 3+', sumWhere((i, j) => i - j >= 3), 'Winning Margin'),
    mk('wmA1', 'Away by 1', wm(-1), 'Winning Margin'),
    mk('wmA2', 'Away by 2', wm(-2), 'Winning Margin'),
    mk('wmA3', 'Away by 3+', sumWhere((i, j) => j - i >= 3), 'Winning Margin'),
  ]});

  const shs = buildScoreMatrix(lH / 2, lA / 2, rho);
  const sh3 = outcomeProbs(shs.raw, shs.sum);
  groups.push({ name: '2nd Half Result', items: [
    mk('sh3Home', 'Home (2nd half)', sh3.home, '2nd Half Result'),
    mk('sh3Draw', 'Draw (2nd half)', sh3.draw, '2nd Half Result'),
    mk('sh3Away', 'Away (2nd half)', sh3.away, '2nd Half Result'),
  ]});

  const topEvBets = groups.flatMap((g) => g.items)
    .filter((it) => it.odds > 1 && it.ev > 0 && !it.anomaly)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, 4);

  return {
    groups, topEvBets, flat,
    pHome, pDraw, pAway, pBttsYes,
    pOver25: sumWhere((i, j) => i + j > 2.5),
    p1X, htft,
  };
}
