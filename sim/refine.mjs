// Second stage: for one floor and rebate size, search the prize ladder with the coin
// rebate counted at what it sells for straight away, then re-run the best candidates with
// ten times the pulls so the winner is not just the luckiest sample.
// Usage: node refine.mjs [floor=8] [rebate=0.3] [candidates=8000]

import { writeFileSync } from "node:fs";
import { hitRate, makeConfig, rng, sessionStats, simulate } from "./model.mjs";

const FLOOR = Number(process.argv[2] ?? 8);
const REBATE = Number(process.argv[3] ?? 0.3);
const CANDIDATES = Number(process.argv[4] ?? 8_000);
const rand = rng(77 + Math.round(FLOOR * 10) + Math.round(REBATE * 100));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const randomWeights = () => {
  const raw = Array.from({ length: 5 }, () => -Math.log(1 - rand()));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => +(x / sum).toFixed(3));
};

const LENGTHS = [10, 20, 50];

function evaluate(raw, pulls, seed) {
  const cfg = makeConfig(raw);
  if (!cfg) return null;
  if (!cfg.probs.slice(1).every((p, i, a) => i === 0 || p < a[i - 1])) return null;
  const sim = simulate(cfg, pulls, seed, cfg.steadyPool, false);
  const by = Object.fromEntries(LENGTHS.map((n) => [n, sessionStats(sim.values, n, raw.fee.rebate)]));
  // Profit share is jumpy at any single session length because prizes are whole numbers,
  // so score on the average over short, medium and long sessions.
  const score = LENGTHS.reduce((a, n) => a + by[n].profitShare, 0) / LENGTHS.length;
  return { raw, cfg, hit: hitRate(cfg), downgrades: sim.downgrades / pulls, by, score };
}

// Jackpot averages at least 2,500; one pull in five breaks even; a typical 20-pull
// session loses no more than 20 USDC; the cap never bites in steady state.
const passes = (e) => e.cfg.steadyPool >= 5_000 && e.hit >= 0.2 && e.by[20].median >= -20 && e.downgrades < 0.0002;

const found = [];
let seed = 1;
for (let n = 0; n < CANDIDATES; ) {
  const e = evaluate(
    {
      floor: FLOOR,
      fee: { rebate: REBATE, creator: 0.1, protocol: 0.3 },
      values: [pick([10, 11, 12]), pick([15, 18, 20, 25]), pick([40, 50, 60]), pick([100, 150, 200]), pick([500, 1000])],
      weights: randomWeights(),
      jackpotAlloc: pick([0.125, 0.15, 0.2, 0.25]),
      pJackpot: pick([1 / 10_000, 1 / 20_000]),
      pity: pick([0, 40, 50, 60]),
    },
    400_000,
    seed++,
  );
  if (!e) continue;
  n++;
  if (passes(e)) found.push(e);
}
const finalists = found
  .sort((a, b) => b.score - a.score)
  .slice(0, 40)
  .map((e, i) => evaluate(e.raw, 4_000_000, 10_000 + i))
  .filter((e) => e && passes(e))
  .sort((a, b) => b.score - a.score);

console.log(`floor ${FLOOR}, rebate ${REBATE}: ${found.length} of ${CANDIDATES} passed the first cut, ${finalists.length} after the long run`);
for (const e of finalists.slice(0, 5)) {
  const r = e.raw;
  console.log(
    `values ${r.values.join("/")} w ${r.weights.join(",")} jp ${r.jackpotAlloc}@1in${Math.round(1 / r.pJackpot)} pity ${r.pity} | pool ${Math.round(e.cfg.steadyPool)} score ${(e.score * 100).toFixed(2)}\n` +
      `    breaks even or better ${(e.hit * 100).toFixed(1)}% of pulls, beats the ticket ${(e.cfg.probs.slice(1).reduce((a, p, i) => a + (i === 5 || r.floor + e.cfg.bonus[i + 1] > 10 ? p : 0), 0) * 100).toFixed(1)}% | odds ${e.cfg.probs.map((p) => (p * 100).toFixed(p < 0.001 ? 4 : 2)).join(" / ")}\n` +
      LENGTHS.map((n) => `    ${n} pulls: profit ${(e.by[n].profitShare * 100).toFixed(1)}% median ${e.by[n].median.toFixed(1)} p10 ${e.by[n].p10.toFixed(1)}`).join("\n"),
  );
}
const best = finalists[0];
writeFileSync(
  new URL(`./refine-floor-${FLOOR}-rebate-${REBATE}.json`, import.meta.url),
  JSON.stringify(best ? { raw: best.raw, probs: best.cfg.probs, steadyPool: best.cfg.steadyPool, hit: best.hit, score: best.score } : null, null, 2),
);
