# ATLAS v9.10 — Project Knowledge Base (live source of truth)
_For AI assistants. The .docx KB describes v8.7; this file supersedes it for everything built since (Parts 26–67). Version 9.10 · August 2026._

## 0. Working in this repo
- Delivery pattern: user creates `tools/tools/partNN.txt` containing one or more `===ATLAS_FILE: <path>===` blocks; `node tools/writer.js tools/tools/partNN.txt` writes the files; then `git add . ; git commit ; git push`.
- **Vercel runs `next build` (full TS strict type-check); local dev does NOT.** Type errors surface only on deploy (incident: TS18048 `'p.entryOdds' is possibly 'undefined'` froze Parts 63–65). Always narrow optional fields before indexing.
- `git diff`/`git log` may open a pager → press `q`.
- Never hand-edit files the user hasn't given you; prefer full-file drops of files you authored.

## 1. Identity & stack
ATLAS = client-side Dixon-Coles football prediction + evidence/learning platform. Next.js 16 (App Router) · TypeScript 5.9 strict · React 19 · Zustand 5 (IndexedDB persistence) · Tailwind 4 · Vercel. **100% client-side computation; zero backend for predictions** (API routes only fetch external data).

## 2. Rules that must never be broken
1. Rho: Standard **−0.13**, Jackpot **−0.08** (`DC_RHO_STANDARD/DC_RHO_JACKPOT` in `src/lib/v9/atlas-types.ts`).
2. Probability bars color-coded by engine (blue=Std, amber=Jp).
3. Live parsing on every keystroke (Screener & slip import badges).
4. **No recalibration below 5 resolved** (`MIN_RECALIBRATION_RESULTS`), auto at every multiple of 5.
5. Monte Carlo = cross-check, never primary.
6. Jackpot purity: no learning adjustments, no decorrelation overrides, confidence cap 72%.
7. Client-side only (KB Rule 7); LLM context is **advisory only — never mutates engine math**.
8. Learning is append-only; void/postponed legs must not count as losses.

## 3. File map (v9)
- `src/lib/v9/atlas-types.ts` — Match/Outcome/GameType/AtlasAnalysis, `emptyMatch`, constants above, `PARAMS_VERSION`.
- `src/lib/v9/math/` — `calibration.ts` (calibrateLambda grid search), `dixon-coles.ts` (buildScoreMatrix, outcomeProbs, tau on 0-0/1-0/0-1/1-1), `adaptive-mc.ts` (adaptiveSimulate, simulateParlay).
- `src/lib/v9/engines/` — `standard.ts` (`atlasAnalyseV9`), `jackpot.ts` (`atlasAnalyseJackpotV9`).
- `src/lib/v9/markets/extended-markets.ts` — `computeExtendedMarketsV9` (23 markets, topEvBets).
- `src/lib/v9/learning/bayesian-learning.ts` — beta-binomial posteriors (H/D/A), time-decay; `defaultParams()`, `recalibrate()`; LearnedParams{posteriors, drawBoost, sofThreshold, rhoAdjust, upsetWeight, hitRates, trend, totalResolved}.
- `src/lib/v9/parsers/` — `fixture-parser.ts` (v9.19: pipe rows, spaced rows, generic `vs` rows, header/date lines), `bet-slip-parser.ts` (23-market classifier), `sportpesa-slip.ts` (v9.23: horizontal regex → chunk extractor → vertical state machine; handles glued dates `14/08/2622:15`, `<br>`, dup rows, split team cells, picks OVER/UNDER + `1 OR X` + Euro Handicap `1(1:0)`; `classifySlip`).
- `src/lib/v9/analysis/screener.ts` — qualityStandard/qualityJackpot, `buildJackpotTicket` (8 legs, ≤2/league), `buildStandardSlate`.
- `src/lib/v9/agents/context-agent.ts` — v1.3 multi-provider (Gemini chain → OpenRouter `:free:online` → `auto:online`), strict-JSON schema, `contextVerdict`.
- `src/lib/v9/store/atlas-store.ts` — Zustand + idb; see §6.
- `src/lib/v9/storage/idb.ts`, `src/lib/v9/ui/atlas-colors.ts` (`fmtPct`).
- Components (`src/components/atlas/`): MatchCard (LOG RESULT H/D/A), ContextBadge, DashboardPanel, ScreenerPanel, LearningPanel, ContextLabPanel, CalibrationPanel (Backtest), JackpotLabPanel, StandardLabPanel, QuickViewTables, SimulationPanel, SummaryPanel, APIPicksPanel, ScrapeButton.
- `src/app/atlas/page.tsx` — tabs: Matches · Dashboard · Screener · Jackpot Lab · Standard Lab · Context Lab · Quick View · Simulations · Learning · Backtest · API Picks; listens for `atlas:tab` CustomEvent (Screener → Matches).

## 4. EV band rule (v9.10, Standard slate)
EV 0–3%: any venue · 3–6%: bookmaker margin ≥6% · >6%: margin ≥8% (divergence guard). Extreme-favorite margin asymmetry → NO-BET/Avoid.

## 5. Intake pipelines
- **Fixtures:** SportPesa PDF select-all → Screener textarea → import (auto-build stars union) → click rows to curate → **➕ Send N selected to Matches** (stars + tab jump). Mega Jackpot has no PDF: user sends screenshots; assistant returns a generic `vs` paste-block (date line + `HH:MM Home vs Away h d a` + country headers).
- **Slips:** Learning tab paste → `parseSportPesaSlip` first, fallback `parseBetSlip` → Import → `addFeedback` (feedback[] + per-market posterior) + `matchId` link (live match or `predictionLabels`).
- **Closing odds / CLV:** entry odds stored at `recordPrediction`; closing via (a) `submitResult(id, outcome, closingOverride?)`, (b) **📸 Snapshot closing odds** = re-paste same card pre-kickoff → `snapshotClosing()` diffs prices → `clv = entry/closing − 1` on the pick.

## 6. Store contract (v9.6)
State: matches, results, feedback, phi, predictions (carry `label`, `entryOdds`, `closingOdds`, `clv`), standardParams, jackpotParams, marketPosteriors (`market:pick` → {alpha,beta}), predictionLabels (matchId→"H v A"), recalibrationLog.
Actions: addMatch/updateMatch/updateOdds/setPhi · recordPrediction (stores label) · submitResult(id, outcome, closingOverride?) · snapshotClosing(fixtures)→n · forceRecalibrate(gt) · clearLearningData · addFeedback (links matchId, updates marketPosteriors on won/lost) · runAllSims/runParlaySim · fetchApiPicks/importApiPicks · export/importSession (includes marketPosteriors+predictionLabels).
Persist key: `atlas_v9_store` (IndexedDB). localStorage: `atlas_context_key`, `atlas_openrouter_key`, `atlas_ctx_<matchId>`.

## 7. Learning loop (two layers)
1. **1X2 beta-binomial per engine** — resolved via LOG RESULT / resolve strip / history-row taps; recalibrates at 5/10/15…; Backtest shows Brier, log-loss, pick accuracy, reliability diagram (baselines: Brier 0.667 uniform, log-loss 1.099).
2. **Per-market posteriors** from slip feedback — Learning "Market Confidence" + Dashboard bars (mean ± 1.96·SE). Trust at n≥15.

## 8. Context agent (semi-auto)
Fetch per match (cached), verdict badge above MatchCard: 🟢 agrees / 🔴 conflicts / ⚖ high-stakes / ⚪ neutral vs engine pick. Providers: Gemini (google_search grounding) → OpenRouter (`:online`). Advisory only.

## 9. Dashboards (Dashboard tab)
Stat cards (★ legs, avg conf, avg edge, **avg CLV**) · Slate Confidence Radar (Confidence/Edge/Margin room/Calm/Discipline) · Calibration Timeline (cumulative hit-rate per engine vs 33%) · Market Confidence Bars. Hand-rolled SVG — no chart deps.

## 10. Evidence to date (16/08 card)
Jackpot n=16: Brier 0.638 (< 0.667 ✅), log-loss 1.057 (< 1.099 ✅), pick acc 37.5%; 40–60% conf bucket underconfident (realized ~60%) → trust those legs most. Market posteriors early: DC-1X ~89% (n7), O1.5 75%, home-U2.5 83% = green shapes; "other" (HT unders) ~43% = avoid. 17-leg parlays ≈ lottery (≈0.44^17) → jackpots = coverage; edge lives in Standard singles + CLV.

## 11. Weekly routine
Import card → curate → send → paper bet → 📸 re-paste ~1h pre-kickoff → after FT: import slip + tap results (+closing) → watch Dashboard/Backtest → never reset between imports.

## 12. Known limits / future ideas
DC lambdas come from one match's odds (market-anchored); league-level posteriors, radar week-over-week, The-Odds-API auto-closing (needs key+quota) remain optional futures. Void legs excluded; orphan pre-v9.4 predictions unresolvable by name (harmless).
