// Economic model for the proposed v2 design: one shared prize pool, a higher floor,
// and a per-pull rebate paid in machine coin. Amounts are in USDC; one pack costs 10.
// Mirrors the on-chain draw rules: pity, the jackpot activation threshold and the cap.

export const PRICE = 10;
export const SETTLE_FEE = 0.01;
const N_TIERS = 7; // N, R, SR, SSR, UR, Legend, Jackpot
const SR = 2;
const JACKPOT = 6;

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Builds a full parameter set from a compact description.
 *   floor      what every pack is worth at least
 *   fee        { rebate, creator, protocol } per pull
 *   values     prize value of R, SR, SSR, UR, Legend
 *   weights    how the fixed-tier budget is shared between those five tiers
 *   jackpotAlloc  pool inflow per pull left for the jackpot
 *   pJackpot   jackpot probability
 *   pity       pulls without SR or better before one is guaranteed (0 = off)
 */
export function makeConfig(c) {
  const feeTotal = c.fee.rebate + c.fee.creator + c.fee.protocol;
  const poolIn = PRICE - c.floor - feeTotal;
  const bonus = [0, ...c.values.map((v) => v - c.floor), 0];
  const jShare = c.jShare ?? 0.5;
  const cap = c.cap ?? 0.25;

  // The pity guarantee costs pool money; solve for the tier budget that leaves exactly
  // `jackpotAlloc` per pull for the jackpot once pity is paid for.
  let pityCost = 0;
  let probs = [];
  for (let iter = 0; iter < 6; iter++) {
    const budget = poolIn - c.jackpotAlloc - pityCost;
    if (budget <= 0) return null;
    probs = [0, 0, 0, 0, 0, 0, c.pJackpot];
    for (let i = 1; i <= 5; i++) probs[i] = (budget * c.weights[i - 1]) / bonus[i];
    probs[0] = 1 - probs.slice(1).reduce((a, b) => a + b, 0);
    if (probs[0] < 0.2) return null;
    if (!c.pity) break;
    const q = probs.slice(SR).reduce((a, b) => a + b, 0);
    const cycle = (1 - (1 - q) ** c.pity) / q;
    const forced = (1 - q) ** (c.pity - 1) / cycle; // share of pulls that are pity pulls
    const lowBonus = (probs[1] * bonus[1]) / (probs[0] + probs[1]);
    pityCost = forced * (bonus[SR] - lowBonus);
  }
  const steadyPool = c.jackpotAlloc / (jShare * c.pJackpot);
  return {
    ...c,
    feeTotal,
    poolIn,
    bonus,
    probs,
    pityCost,
    jShare,
    cap,
    steadyPool,
    jackpotMin: c.jackpotMin ?? Math.round(steadyPool * (c.jackpotMinShare ?? 0.4)),
  };
}

/** Runs `n` pulls against one shared pool and returns per-pull values plus pool statistics. */
export function simulate(cfg, n, seed, startPool = 0, trackUnlocks = startPool === 0) {
  const rand = rng(seed);
  const cum = [];
  let acc = 0;
  for (const p of cfg.probs) cum.push((acc += p));
  const values = new Float32Array(n);
  const hits = new Array(N_TIERS).fill(0);
  let pool = startPool;
  let dry = 0;
  let poolSum = 0;
  let poolMax = 0;
  let downgrades = 0;
  let pityPulls = 0;
  let legendLocked = 0;
  let jackpotOff = 0;
  let poolMin = Infinity;
  const jackpots = [];
  const jackpotAt = [];
  const unlockedAt = new Array(N_TIERS).fill(-1);

  for (let i = 0; i < n; i++) {
    pool += cfg.poolIn;
    if (pool * cfg.cap < cfg.bonus[JACKPOT - 1]) legendLocked++;
    if (pool < cfg.jackpotMin) jackpotOff++;
    const r = rand();
    let tier = 0;
    while (tier < N_TIERS - 1 && r >= cum[tier]) tier++;
    let forced = false;
    if (cfg.pity && tier < SR && dry + 1 >= cfg.pity) {
      tier = SR;
      forced = true;
      pityPulls++;
    }
    if (tier === JACKPOT && pool < cfg.jackpotMin) tier = JACKPOT - 1;
    let b;
    if (tier === JACKPOT) {
      b = pool * cfg.jShare;
      jackpots.push(b);
      jackpotAt.push(i);
    } else {
      const limit = pool * cfg.cap;
      const wanted = tier;
      while (tier > 0 && cfg.bonus[tier] > limit) tier--;
      if (tier !== wanted) downgrades++;
      b = cfg.bonus[tier];
    }
    pool -= b;
    // A pity pull uses up the guarantee even when the cap downgrades it. If it did not
    // (cfg.pityTrap, the rule the deployed program uses), a small pool would hand out the
    // best affordable prize on every pull and never grow.
    dry = tier >= SR || (forced && !cfg.pityTrap) ? 0 : dry + 1;
    values[i] = cfg.floor + b;
    hits[tier]++;
    poolSum += pool;
    if (pool > poolMax) poolMax = pool;
    if (pool < poolMin) poolMin = pool;
    if (trackUnlocks) {
      // First pull at which each tier could have been paid in full
      for (let t = 1; t <= 5; t++) if (unlockedAt[t] < 0 && pool * cfg.cap >= cfg.bonus[t]) unlockedAt[t] = i + 1;
      if (unlockedAt[JACKPOT] < 0 && pool >= cfg.jackpotMin) unlockedAt[JACKPOT] = i + 1;
    }
  }
  return {
    values,
    hits,
    pool,
    poolMean: poolSum / n,
    poolMax,
    poolMin,
    downgrades,
    pityPulls,
    jackpots,
    jackpotAt,
    unlockedAt,
    legendLockedShare: legendLocked / n,
    jackpotOffShare: jackpotOff / n,
  };
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/**
 * Cuts a stream of pull values into sessions of `len` pulls and reports what a player
 * walks away with. Claims pay the 1% settlement fee. `rebate` is counted at face value
 * minus the 1% it costs to sell.
 */
export function sessionStats(values, len, rebate = 0) {
  const sessions = Math.floor(values.length / len);
  const pnl = new Float64Array(sessions);
  let profitable = 0;
  for (let s = 0; s < sessions; s++) {
    let got = 0;
    for (let i = s * len; i < (s + 1) * len; i++) got += values[i];
    const net = got * (1 - SETTLE_FEE) + rebate * 0.99 * len - PRICE * len;
    pnl[s] = net;
    if (net > 0) profitable++;
  }
  const sorted = Array.from(pnl).sort((a, b) => a - b);
  return {
    profitShare: profitable / sessions,
    median: quantile(sorted, 0.5),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
    worst: sorted[0],
    mean: sorted.reduce((a, b) => a + b, 0) / sessions,
  };
}

/** Share of pulls worth at least the ticket price. */
export function hitRate(cfg) {
  let p = 0;
  for (let i = 1; i < N_TIERS; i++) if (i === JACKPOT || cfg.floor + cfg.bonus[i] >= PRICE) p += cfg.probs[i];
  return p;
}

/** The design that is deployed today, for comparison. */
export const BASELINE = {
  name: "current (deployed)",
  floor: 5,
  fee: { rebate: 0, creator: 0, protocol: 0.8 },
  poolIn: 4.2,
  feeTotal: 0.8,
  bonus: [0, 3, 7, 25, 95, 495, 0],
  probs: [0.6304, 0.22, 0.12, 0.025, 0.004, 0.0004, 0.0002],
  pity: 30,
  cap: 0.25,
  jShare: 0.5,
  jackpotMin: 4_000,
  steadyPool: 14_970,
};
