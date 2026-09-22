// tools/scraper.mjs — v2: + Betika 10-column print/list dialect (DC + O/U 2.5 + GG/NG)
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SITE = process.argv[2] ?? 'betika';
const URL = process.argv[3] ?? (SITE === 'betika'
  ? 'https://www.betika.com/en-ke/jackpots'
  : 'https://www.sportpesa.com/ke/games');
const headless = process.env.HEADLESS !== '0';

const browser = await chromium.launch({ headless });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(4000);
for (let i = 0; i < 3; i++) {
  const btn = page.locator('button:has-text("Load More"), button:has-text("Show More")').first();
  if (await btn.count().catch(() => 0) && await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(1500); } else break;
}
const text = await page.evaluate(() => document.body.innerText);
await browser.close();

mkdirSync('tools/scrapes', { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
writeFileSync(`tools/scrapes/${SITE}-${stamp}.raw.txt`, text);

const lines = text.split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const isOdd = (s) => /^\d+\.\d+$/.test(s ?? '');
const oddsTok = (s) => isOdd(s) || s === '-';
const isDate = (s) => /^\d{2}\/\d{2}\/\d{2,4}$/.test(s ?? '');
const isTime = (s) => /^\d{1,2}:\d{2}$/.test(s ?? '');
const clean = (s) => (s ?? '').replace(/Apply Pass|Auto Pick|Clear All/gi, '').trim();
const fixtures = [];
const seen = new Set();
const push = (f) => { const k = f.home + f.away; if (!seen.has(k) && f.home && f.away) { seen.add(k); fixtures.push(f); } };

for (let i = 0; i < lines.length; i++) {
  // A: Betika vertical web (1X2)
  const wm = lines[i].match(/^soccer\s*-\s*(.*?)(\d{2}\/\d{2}),?\s*(\d{1,2}:\d{2})$/i);
  if (wm) {
    const seq = lines.slice(i + 3, i + 9);
    if (seq[0] === '1' && seq[2] === 'X' && seq[4] === '2' && isOdd(seq[1]) && isOdd(seq[3]) && isOdd(seq[5])) {
      push({ league: wm[1].replace(/[.,\s…]+$/, '').trim(), date: wm[2], time: wm[3], home: clean(lines[i + 1]), away: clean(lines[i + 2]), odds: [seq[1], seq[3], seq[5]] });
      i += 8; continue;
    }
  }
  // C: Betika print/list table — date, time, [id], "A vs B", 10 odds
  if (isDate(lines[i]) && isTime(lines[i + 1])) {
    let j = i + 2;
    if (/^\d{3,6}$/.test(lines[j] ?? '')) j++;
    const match = lines[j] ?? '';
    if (/\s+vs\.?\s+/i.test(match)) {
      const od = lines.slice(j + 1, j + 11);
      if (od.length === 10 && od.slice(0, 3).every(isOdd) && od.slice(3).every(oddsTok)) {
        const [home, away] = match.split(/\s+vs\.?\s+/i);
        push({ league: '', date: lines[i], time: lines[i + 1], home: clean(home), away: clean(away), odds: od });
        i = j + 10; continue;
      }
    }
  }
  // B: SportPesa 1/X/2 buttons
  let h, d, a, consumed = 0;
  const one = lines[i].match(/^1\s+(\d+\.\d+)\s+X\s+(\d+\.\d+)\s+2\s+(\d+\.\d+)$/i);
  const three = lines[i].match(/^1\s+(\d+\.\d+)$/i) && lines[i + 1]?.match(/^X\s+(\d+\.\d+)$/i) && lines[i + 2]?.match(/^2\s+(\d+\.\d+)$/i);
  if (one) { [h, d, a] = [one[1], one[2], one[3]]; }
  else if (three) { [h, d, a] = [three[1], lines[i + 1].match(/(\d+\.\d+)/)[1], lines[i + 2].match(/(\d+\.\d+)/)[1]]; consumed = 2; }
  else continue;
  const home = clean(lines[i - 2]), away = clean(lines[i - 1]);
  if (!home || !away || isOdd(home) || isOdd(away)) continue;
  let league = '', date = '', time = '';
  for (let k = i - 1; k >= Math.max(0, i - 8); k--) {
    const dm = lines[k].match(/(\d{2}\/\d{2}),?\s*(\d{1,2}:\d{2})/);
    if (dm && !date) { date = dm[1]; time = dm[2]; }
    if (/^soccer/i.test(lines[k]) && !league) league = lines[k].replace(/^soccer\s*[•>:-]?\s*/i, '').replace(/[.,\s…]+$/, '');
  }
  push({ league, date, time, home, away, odds: [h, d, a] });
  i += consumed;
}

const dated = fixtures.filter((f) => f.date);
const row = (f) => `${f.date.length > 6 ? f.date : f.date + '/2026'} ${f.time} ${f.home} vs ${f.away} ${f.odds.join(' ')}`;
const block = (dated.length ? dated : fixtures).map(row).join('\n');

writeFileSync(`tools/scrapes/${SITE}-${stamp}.block.txt`, block);
writeFileSync(`tools/scrapes/${SITE}-${stamp}.json`, JSON.stringify(fixtures, null, 2));
console.log(`✅ ${fixtures.length} fixtures (${dated.length} dated, ${fixtures.filter((f) => f.odds.length === 10).length} with extended cols)`);
console.log(block || '(none — send me the .raw.txt to tune)');
try { execSync('clip', { input: block }); console.log('📋 copied to clipboard'); } catch { /* non-Windows */ }