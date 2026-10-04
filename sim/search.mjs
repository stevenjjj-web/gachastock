// Random search over the v2 parameters. Each candidate is simulated from its steady-state
// pool and scored on what a 20-pull session looks like for the player.
// Usage: node search.mjs [candidates=24000] [pullsPerCandidate=200000]

import { writeFileSync } from "node:fs";
import { BASELINE, hitRate, makeConfig, rng, sessionStats, simulate } from "./model.mjs";

const CANDIDATES = Number(process.argv[2] ?? 24_000);
const PULLS = Number(process.argv[3] ?? 200_000);
const rand = rng(20261004);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

/** Random split of the fixed-tier budget across R, SR, SSR, UR, Legend. */
function randomWeights() {
  const raw = Array.from({ length: 5 }, () => -Math.log(1 - rand()));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => +(x / sum).toFixed(3));
}

const rows = [];
let seed = 1;
while (rows.length < CANDIDATES) {
  const raw = {
    floor: pick([7, 7.5, 8, 8.5]),
    fee: { rebate: pick([0.2, 0.3, 0.4]), creator: 0.1, protocol: 0.3 },
    values: [pick([10, 11, 12]), pick([15, 18, 20, 25]), pick([40, 50, 60]), pick([100, 150, 200]), pick([500, 1000])],
    weights: randomWeights(),
    jackpotAlloc: pick([0.1, 0.125, 0.15, 0.2, 0.25]),
    pJackpot: pick([1 / 10_000, 1 / 20_000]),
    pity: pick([0, 40, 50, 60]),
  };
  const cfg = makeConfig(raw);
  if (!cfg) continue;
  // Rarer tiers must be worth more: probabilities strictly fall from R to the jackpot
  if (!cfg.probs.slice(1).every((p, i, a) => i === 0 || p < a[i - 1])) continue;
  const sim = simulate(cfg, PULLS, seed++, cfg.steadyPool, false);
  const s20 = sessionStats(sim.values, 20);
  const s20r = sessionStats(sim.values, 20, raw.fee.rebate);
  rows.push({
    ...raw,
    rebate: raw.fee.rebate,
    poolIn: +cfg.poolIn.toFixed(3),
    steadyPool: Math.round(cfg.steadyPool),
    probs: cfg.probs.map((p) => +p.toFixed(6)),
    hit: +hitRate(cfg).toFixed(4),
    downgrades: sim.downgrades / PULLS,
    profit20: +s20.profitShare.toFixed(4),
    median20: +s20.median.toFixed(1),
    p10_20: +s20.p10.toFixed(1),
    profit20r: +s20r.profitShare.toFixed(4),
    median20r: +s20r.median.toFixed(1),
  });
}
writeFileSync(new URL("./search-results.json", import.meta.url), JSON.stringify(rows));
console.log(`${rows.length} candidates, ${PULLS.toLocaleString()} pulls each`);

{
  const sim = simulate(BASELINE, 2_000_000, 99, BASELINE.steadyPool, false);
  const s = sessionStats(sim.values, 20);
  console.log(`baseline (deployed): hit ${(hitRate(BASELINE) * 100).toFixed(1)}% | profit20 ${(s.profitShare * 100).toFixed(1)}% median ${s.median.toFixed(1)} p10 ${s.p10.toFixed(1)}`);
}

const fmt = (r) =>
  `floor ${r.floor} rebate ${r.rebate} values ${r.values.join("/")} w ${r.weights.join(",")} jp ${r.jackpotAlloc}@1in${Math.round(1 / r.pJackpot)} pity ${String(r.pity).padStart(2)}\n` +
  `    pool ${r.steadyPool} hit ${(r.hit * 100).toFixed(1)}% | profit20 ${(r.profit20 * 100).toFixed(1)}% median ${r.median20} p10 ${r.p10_20} | counting the rebate: ${(r.profit20r * 100).toFixed(1)}% median ${r.median20r}`;

// Selection rule:
//   1. average jackpot of at least 2,500 USDC (steady pool >= 5,000)
//   2. at least one pull in five breaks even or better
//   3. a typical 20-pull session loses no more than 25 USDC (12.5% of what was spent)
//   4. no cap downgrades in steady state
// and among those, the highest share of 20-pull sessions that end in profit.
const ok = (r) => r.steadyPool >= 5_000 && r.hit >= 0.2 && r.median20 >= -25 && r.downgrades < 0.0002;
const passing = rows.filter(ok).sort((a, b) => b.profit20 - a.profit20);
console.log(`\n${passing.length} candidates pass the selection rule`);
for (const floor of [7, 7.5, 8, 8.5]) {
  console.log(`\n== floor ${floor}: best three ==`);
  passing.filter((r) => r.floor === floor).slice(0, 3).forEach((r) => console.log(fmt(r)));
}
console.log("\n== without the median limit, for reference: best by profitable sessions ==");
rows
  .filter((r) => r.steadyPool >= 5_000 && r.hit >= 0.2 && r.downgrades < 0.0002)
  .sort((a, b) => b.profit20 - a.profit20)
  .slice(0, 4)
  .forEach((r) => console.log(fmt(r)));
