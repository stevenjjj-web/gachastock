// Full validation of the chosen v2 parameters against the deployed design.
// Usage: node final.mjs

import { BASELINE, PRICE, SETTLE_FEE, hitRate, sessionStats, simulate } from "./model.mjs";

const PPM = 1_000_000;

/** Builds a config from explicit odds in ppm (the way they would be stored on-chain). */
function fromOdds({ name, floor, fee, values, ppm, pity, jackpotMin, cap = 0.25, seedPool = 0 }) {
  const feeTotal = fee.rebate + fee.creator + fee.protocol;
  const bonus = [0, ...values.map((v) => v - floor), 0];
  const probs = [0, ...ppm].map((x) => x / PPM);
  probs[0] = 1 - probs.reduce((a, b) => a + b, 0);
  const poolIn = PRICE - floor - feeTotal;
  const fixed = probs.slice(1, 6).reduce((a, p, i) => a + p * bonus[i + 1], 0);
  return { name, floor, fee, feeTotal, poolIn, bonus, probs, pity, cap, jShare: 0.5, jackpotMin, seedPool, fixedSpend: fixed };
}

const fee = { rebate: 0.3, creator: 0.1, protocol: 0.3 };
const CANDIDATES = [
  // Recommended: 75% floor, R is a small real win
  fromOdds({ name: "v2 floor 7.5 (recommended)", floor: 7.5, fee, values: [11, 25, 40, 100, 500], ppm: [175_000, 22_500, 13_000, 500, 200, 50], pity: 60, jackpotMin: 2_000 }),
  // Same odds with a 1,000 USDC Legend at half the frequency
  fromOdds({ name: "v2 floor 7.5, Legend 1,000", floor: 7.5, fee, values: [11, 25, 40, 100, 1000], ppm: [175_000, 22_500, 13_000, 500, 100, 50], pity: 60, jackpotMin: 2_000 }),
  // Conservative alternative: 80% floor
  fromOdds({ name: "v2 floor 8.0 (conservative)", floor: 8, fee, values: [10, 25, 50, 100, 500], ppm: [200_000, 16_500, 4_600, 400, 150, 50], pity: 50, jackpotMin: 2_000 }),
];

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const money = (x) => (x === undefined || !Number.isFinite(x) ? "n/a" : Math.abs(x) >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(1));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function report(cfg, rebate) {
  console.log(`\n================ ${cfg.name} ================`);
  if (cfg.fixedSpend !== undefined) {
    console.log(
      `per 10 USDC: floor ${cfg.floor}, prize pool ${cfg.poolIn.toFixed(2)}, coin rebate ${cfg.fee.rebate}, creator ${cfg.fee.creator}, protocol ${cfg.fee.protocol}`,
    );
    console.log(`fixed tiers cost ${cfg.fixedSpend.toFixed(3)} per pull before pity`);
  }
  console.log(`odds N/R/SR/SSR/UR/Legend/Jackpot: ${cfg.probs.map((p) => pct(p, p < 0.001 ? 3 : 2)).join(" / ")}`);
  console.log(`breaks even or better on ${pct(hitRate(cfg))} of pulls`);

  // Cold start from an empty pool: when does each tier become payable
  const N = 2_000_000;
  const cold = [1, 2, 3, 4].map((seed) => simulate(cfg, N, seed, 0, true));
  const unlock = (t) => `${Math.min(...cold.map((c) => c.unlockedAt[t])).toLocaleString("en-US")}–${Math.max(...cold.map((c) => c.unlockedAt[t])).toLocaleString("en-US")}`;
  console.log(`cold start from an empty pool, pulls until payable: UR ${unlock(4)}, Legend ${unlock(5)}, jackpot ${unlock(6)}`);
  if (cfg.fixedSpend !== undefined) {
    const seeded = [1, 2, 3, 4].map((seed) => simulate(cfg, 200_000, seed, 2_000, true));
    const u = (t) => `${Math.min(...seeded.map((c) => c.unlockedAt[t])).toLocaleString("en-US")}–${Math.max(...seeded.map((c) => c.unlockedAt[t])).toLocaleString("en-US")}`;
    console.log(`  with a 2,000 USDC seed: Legend ${u(5)}, jackpot ${u(6)}`);
    // The pity rule as the deployed program has it: a downgraded pity pull does not reset the streak
    const trapped = simulate({ ...cfg, pityTrap: true }, 500_000, 1, 0, true);
    console.log(`  with the deployed pity rule the pool reaches ${money(trapped.poolMax)} at most and ends at ${money(trapped.pool)} after 500,000 pulls`);
  }

  // Steady state: start at the long-run pool so the cold start does not skew the picture
  const start = Math.round(cold.reduce((a, c) => a + c.poolMean, 0) / cold.length);
  const runs = [11, 12, 13, 14].map((seed) => simulate(cfg, N, seed, start, false));
  const all = (f) => runs.map(f);
  const jackpots = runs.flatMap((r) => r.jackpots);
  const gaps = runs.flatMap((r) => r.jackpotAt.slice(1).map((x, i) => x - r.jackpotAt[i]));
  console.log(`steady pool: mean ${all((r) => Math.round(r.poolMean)).join(" / ")}, lowest ${money(Math.min(...all((r) => r.poolMin)))}, highest ${money(Math.max(...all((r) => r.poolMax)))}`);
  console.log(
    `jackpots: ${jackpots.length} in ${(4 * N).toLocaleString("en-US")} pulls, mean ${money(jackpots.reduce((a, b) => a + b, 0) / jackpots.length)}, median ${money(median(jackpots))}, smallest ${money(Math.min(...jackpots))}, largest ${money(Math.max(...jackpots))}, median gap ${median(gaps).toLocaleString("en-US")} pulls`,
  );
  console.log(
    `jackpot switched off ${pct(runs.reduce((a, r) => a + r.jackpotOffShare, 0) / 4)} of the time, Legend not payable ${pct(runs.reduce((a, r) => a + r.legendLockedShare, 0) / 4)} of the time, cap downgrades ${runs.reduce((a, r) => a + r.downgrades, 0)}, pity pulls ${pct(runs.reduce((a, r) => a + r.pityPulls, 0) / (4 * N), 2)}`,
  );
  const paidOut = runs.reduce((a, r) => a + r.values.reduce((x, y) => x + y, 0), 0) / (4 * N);
  console.log(
    `average pack pays ${paidOut.toFixed(3)} (${pct(paidOut / PRICE)}), ${pct((paidOut * (1 - SETTLE_FEE)) / PRICE)} after the settlement fee` +
      (rebate ? `, ${pct((paidOut * (1 - SETTLE_FEE) + rebate * 0.99) / PRICE)} counting the coin rebate` : ""),
  );

  console.log("what a session looks like (profit share | median | worst 10% | best 10%):");
  for (const len of [10, 20, 50, 100]) {
    const merged = { profit: 0, median: 0, p10: 0, p90: 0 };
    for (const r of runs) {
      const s = sessionStats(r.values, len, rebate);
      merged.profit += s.profitShare / 4;
      merged.median += s.median / 4;
      merged.p10 += s.p10 / 4;
      merged.p90 += s.p90 / 4;
    }
    console.log(
      `  ${String(len).padStart(3)} pulls (${len * PRICE} USDC): ${pct(merged.profit).padStart(6)} | ${money(merged.median).padStart(6)} | ${money(merged.p10).padStart(6)} | ${money(merged.p90).padStart(6)}`,
    );
  }
}

report(BASELINE, 0);
for (const cfg of CANDIDATES) report(cfg, cfg.fee.rebate);
