// ============================================================
// Bet slip parser — 23 market classifier + manual entry options
// ============================================================
export type BetMarket =
  | '1x2' | 'over15' | 'under15' | 'over25' | 'under25' | 'over35' | 'under35'
  | 'btts_yes' | 'btts_no' | 'double_chance' | 'asian_handicap' | 'correct_score'
  | 'half_time_result' | 'half_time_full_time' | 'first_goalscorer' | 'exact_goals'
  | 'home_over25' | 'away_over25' | 'clean_sheet' | 'goal_range'
  | 'ftr_over' | 'ftr_btts' | 'other';

export interface ParsedBet {
  teams: string; market: BetMarket; pick: string; odds: number;
  result: 'won' | 'lost' | 'pending'; score?: string;
}

export const MANUAL_MARKET_OPTIONS: { value: BetMarket; label: string; picks: string[] }[] = [
  { value: '1x2', label: '1X2 (Home/Draw/Away)', picks: ['Home', 'Draw', 'Away'] },
  { value: 'over15', label: 'Over 1.5 Goals', picks: ['Over 1.5'] },
  { value: 'under15', label: 'Under 1.5 Goals', picks: ['Under 1.5'] },
  { value: 'over25', label: 'Over 2.5 Goals', picks: ['Over 2.5'] },
  { value: 'under25', label: 'Under 2.5 Goals', picks: ['Under 2.5'] },
  { value: 'over35', label: 'Over 3.5 Goals', picks: ['Over 3.5'] },
  { value: 'under35', label: 'Under 3.5 Goals', picks: ['Under 3.5'] },
  { value: 'btts_yes', label: 'BTTS Yes', picks: ['Yes'] },
  { value: 'btts_no', label: 'BTTS No', picks: ['No'] },
  { value: 'double_chance', label: 'Double Chance', picks: ['1X', 'X2', '12'] },
  { value: 'asian_handicap', label: 'Asian Handicap', picks: ['-1', '-0.5', '0', '+0.5', '+1'] },
  { value: 'correct_score', label: 'Correct Score', picks: ['1-0', '2-0', '2-1', '1-1', '0-0', '0-1', '1-2', '0-2'] },
  { value: 'half_time_result', label: 'Half Time Result', picks: ['Home HT', 'Draw HT', 'Away HT'] },
  { value: 'half_time_full_time', label: 'HT/FT', picks: ['1/1', '1/X', 'X/1', 'X/X', 'X/2', '2/X', '2/2'] },
  { value: 'first_goalscorer', label: 'First To Score', picks: ['Home', 'Away', 'None'] },
  { value: 'exact_goals', label: 'Exact Total Goals', picks: ['0', '1', '2', '3', '4', '5', '6+'] },
  { value: 'home_over25', label: 'Home Over 2.5', picks: ['Over 2.5'] },
  { value: 'away_over25', label: 'Away Over 2.5', picks: ['Over 2.5'] },
  { value: 'clean_sheet', label: 'Clean Sheet', picks: ['Home', 'Away'] },
  { value: 'goal_range', label: 'Goal Range', picks: ['0-1', '2-3', '4-5', '6+'] },
  { value: 'ftr_over', label: 'FTR + Over/Under', picks: ['1 & O2.5', 'X & U2.5', '2 & O1.5'] },
  { value: 'ftr_btts', label: 'FTR + BTTS', picks: ['1 & GG', 'X & NG', '2 & GG'] },
  { value: 'other', label: 'Other', picks: ['Custom'] },
];

export function classifyMarket(text: string): BetMarket {
  const t = text.toLowerCase();
  if (/\b(btts|gg|ng|both teams to score)\b/.test(t)) {
    if (/&|and/.test(t)) return 'ftr_btts';
    return /\b(ng|no)\b/.test(t) ? 'btts_no' : 'btts_yes';
  }
  if (/(over|under).*&|&.*(over|under)/.test(t) || /\b(ftr)\b/.test(t)) return 'ftr_over';
  if (/ht\/ft|half time\/full time|\b[12x]\/[12x]\b/.test(t)) return 'half_time_full_time';
  if (/correct score|\bcs\b|\d-\d/.test(t)) return 'correct_score';
  if (/first (goal)?scorer|to score first/.test(t)) return 'first_goalscorer';
  if (/exact.*goals|total goals exactly/.test(t)) return 'exact_goals';
  if (/clean sheet/.test(t)) return 'clean_sheet';
  if (/goal range|\b0-1 goals\b|\b2-3 goals\b/.test(t)) return 'goal_range';
  if (/(home|away).*(over|under).*2\.5/.test(t)) return t.includes('home') ? 'home_over25' : 'away_over25';
  if (/handicap|ah\b/.test(t) || /(^|\s)[+-]1(\s|$)/.test(t) || /[+-]0\.\d+/.test(t)) return 'asian_handicap';
  if (/double chance|\b(1x|x2|12)\b/.test(t)) return 'double_chance';
  if (/half time result|\bht\b.*(home|draw|away)/.test(t)) return 'half_time_result';
  if (/over\s*1\.5/.test(t)) return 'over15';
  if (/over\s*2\.5/.test(t)) return 'over25';
  if (/over\s*3\.5/.test(t)) return 'over35';
  if (/under\s*1\.5/.test(t)) return 'under15';
  if (/under\s*2\.5/.test(t)) return 'under25';
  if (/under\s*3\.5/.test(t)) return 'under35';
  if (/over|under/.test(t)) return 'over25';
  if (/home|draw|away|\b1x2\b/.test(t)) return '1x2';
  return 'other';
}

export function parseBetSlip(text: string): ParsedBet[] {
  const bets: ParsedBet[] = [];
  if (!text.trim()) return bets;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let current: Partial<ParsedBet> = {};

  for (const line of lines) {
    if (/multi bet|bet id|stake|total odds/i.test(line)) {
      if (current.teams && current.odds) bets.push(finalize(current));
      current = {};
      continue;
    }
    const result: ParsedBet['result'] = /✅|✔|won/i.test(line) ? 'won' : /❌|✘|lost/i.test(line) ? 'lost' : 'pending';
    const pickLine = line.match(/^(?:pick|selection)[:\s]+(.+?)(?:\s*\((\d+\.?\d*)\))?\s*([✅✔❌✘])?$/i);
    if (pickLine) {
      current.pick = pickLine[1].trim();
      if (pickLine[2]) current.odds = parseFloat(pickLine[2]);
      if (pickLine[3]) current.result = pickLine[3] === '❌' || pickLine[3] === '✘' ? 'lost' : 'won';
      current.market = classifyMarket(current.pick);
      continue;
    }
    const oddsLine = line.match(/odds[:\s]+(\d+\.?\d*)/i);
    if (oddsLine) { current.odds = parseFloat(oddsLine[1]); continue; }
    const scoreLine = line.match(/(?:ft|score)[:\s]+(\d+)\s*[-:]\s*(\d+)/i);
    if (scoreLine) { current.score = `${scoreLine[1]}-${scoreLine[2]}`; continue; }
    if (/(vs| v | - )/i.test(line) || /^[A-Z].+ [A-Z]/.test(line)) {
      if (current.teams && current.odds) { bets.push(finalize(current)); current = {}; }
      current.teams = line;
      if (!current.result) current.result = result;
      if (!current.market) current.market = classifyMarket(line);
    }
  }
  if (current.teams && current.odds) bets.push(finalize(current));
  return bets;
}

function finalize(c: Partial<ParsedBet>): ParsedBet {
  return {
    teams: c.teams ?? 'Unknown', market: c.market ?? 'other',
    pick: c.pick ?? '', odds: c.odds ?? 1, result: c.result ?? 'pending', score: c.score,
  };
}

export function computeMarketStats(bets: ParsedBet[]) {
  const map = new Map<BetMarket, { total: number; wins: number }>();
  for (const b of bets) {
    if (b.result === 'pending') continue;
    const e = map.get(b.market) ?? { total: 0, wins: 0 };
    e.total++;
    if (b.result === 'won') e.wins++;
    map.set(b.market, e);
  }
  return [...map.entries()]
    .map(([market, s]) => ({ market, ...s, hitRate: s.total ? s.wins / s.total : 0 }))
    .sort((a, b) => b.total - a.total);
}
