// ============================================================
// Seed for cohort USER_PARLAY_2026_10_20 — the four slips as
// reconciled from the user's slip screenshots (19 Oct 2026).
// Entry odds = slip prices (source: betika-slip-screenshot).
// atlasProb = null (NOT supplied yet -> cross-check not run,
// per stop condition). Zero closing captures -> CLV missing.
// Payout readings flagged unverified where the screenshot
// payout/odds ratio disagrees (KOL8UA, KSK4AA).
// ============================================================
import { appendParlayEvent, PARLAY_COHORT } from './parlay-ledger';
import type { LegRecord, SlipRecord } from './parlay-ledger';

type LegTuple = [slip: string, n: number, fixtureId: string, teams: string, competition: string, kickoff: string, market: '1x2' | 'ou25', selection: string, entryOdds: number];

const EAT = (s: string) => `2026-10-${s}+03:00`;

const LEGS: LegTuple[] = [
  ['KOL8UA', 1, '71987', 'Asyut Petroleum vs Zamalek Sc', 'Premier League (Egypt)', EAT('20T17:00:00'), '1x2', 'away', 1.41],
  ['KOL8UA', 2, '82434', 'Dewa United vs Persijap J Epara', 'Liga 1 (Indonesia)', EAT('20T15:00:00'), '1x2', 'home', 1.22],
  ['KOL8UA', 3, '53663', 'Al-Taawoun FC vs Al Qadsiah', 'Pro League (Saudi Arabia)', EAT('20T18:10:00'), '1x2', 'away', 1.47],
  ['KH0BBA', 1, '93750', 'FC United vs Altrincham', 'National League North (England)', EAT('20T21:45:00'), '1x2', 'draw', 4.10],
  ['KH0BBA', 2, '81382', 'Luton vs Barnsley', 'League One (England)', EAT('20T21:45:00'), '1x2', 'home', 1.53],
  ['KH0BBA', 3, '41978', 'Huddersfield vs Peterborough', 'League One (England)', EAT('20T21:45:00'), '1x2', 'home', 1.61],
  ['KN1EJA', 1, '48941', 'Guadalajara Chivas vs Necaxa', 'Liga MX (Mexico)', EAT('21T03:07:00'), '1x2', 'home', 1.41],
  ['KN1EJA', 2, '81382', 'Luton vs Barnsley', 'League One (England)', EAT('20T21:45:00'), 'ou25', 'over', 1.42],
  ['KN1EJA', 3, '41978', 'Huddersfield vs Peterborough', 'League One (England)', EAT('20T21:45:00'), '1x2', 'home', 1.61],
  ['KN1EJA', 4, '71987', 'Asyut Petroleum vs Zamalek Sc', 'Premier League (Egypt)', EAT('20T17:00:00'), '1x2', 'away', 1.41],
  ['KN1EJA', 5, '82434', 'Dewa United vs Persijap J Epara', 'Liga 1 (Indonesia)', EAT('20T15:00:00'), '1x2', 'home', 1.22],
  ['KN1EJA', 6, '53663', 'Al-Taawoun FC vs Al Qadsiah', 'Pro League (Saudi Arabia)', EAT('20T18:10:00'), '1x2', 'away', 1.47],
  ['KN1EJA', 7, '61337', 'Al-Nassr FC vs Neom Sc', 'Pro League (Saudi Arabia)', EAT('20T21:00:00'), '1x2', 'home', 1.43],
  ['KN1EJA', 8, '69212', 'Barnet vs Swindon Town', 'League Two (England)', EAT('20T21:45:00'), '1x2', 'home', 1.49],
  ['KN1EJA', 9, '53800', 'Chesterfield vs Colchester', 'League Two (England)', EAT('20T21:45:00'), '1x2', 'home', 1.57],
  ['KN1EJA', 10, '82802', 'York vs Accrington', 'League Two (England)', EAT('20T21:45:00'), '1x2', 'home', 1.69],
  ['KSK4AA', 1, '69212', 'Barnet vs Swindon Town', 'League Two (England)', EAT('20T21:45:00'), '1x2', 'home', 1.49],
  ['KSK4AA', 2, '53800', 'Chesterfield vs Colchester', 'League Two (England)', EAT('20T21:45:00'), '1x2', 'home', 1.57],
  ['KSK4AA', 3, '82802', 'York vs Accrington', 'League Two (England)', EAT('20T21:45:00'), '1x2', 'home', 1.69],
];

const SLIPS: Array<[id: string, stake: number, payout: number, verified: boolean, placed: string, combined: number]> = [
  ['KOL8UA', 110, 264.9, false, '2026-10-19T11:32:00+03:00', 2.41],
  ['KH0BBA', 110, 1109.9, true, '2026-10-19T11:52:00+03:00', 10.09],
  ['KN1EJA', 10, 453.2, true, '2026-10-19T11:14:00+03:00', 45.32],
  ['KSK4AA', 110, 358.5, false, '2026-10-19T11:12:00+03:00', 3.95],
];

export function seedParlayCohort(): void {
  for (const [id, stake, payout, verified, placed, combined] of SLIPS) {
    const legIds = LEGS.filter((l) => l[0] === id).map((l) => `${id}-L${l[1]}`);
    const slip: SlipRecord = {
      slipId: id, cohortId: PARLAY_COHORT, stake, currency: 'KES',
      potentialPayout: payout, payoutVerified: verified, placedAt: placed,
      combinedOdds: combined, status: 'open', settledAt: null, grossReturn: null, netPl: null, legIds,
    };
    appendParlayEvent({ type: 'slip', at: Date.parse(placed), eventId: `slip:${id}`, slip });
    for (const [sid, n, fixtureId, teams, competition, kickoff, market, selection, odds] of LEGS.filter((l) => l[0] === id)) {
      const leg: LegRecord = {
        legId: `${sid}-L${n}`, slipId: sid, fixtureId, teams, competition, kickoff, tz: 'EAT',
        market, selection, entryOdds: odds, entrySource: 'betika-slip-screenshot', entryAt: Date.parse(placed),
        atlasProb: null, atlasProbVersion: null, status: 'pending', settledAt: null, settlementSource: null,
      };
      appendParlayEvent({ type: 'leg', at: Date.parse(placed), eventId: `leg:${sid}-L${n}`, leg });
    }
  }
}