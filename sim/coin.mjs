// Machine coin under "play to own": every pull spends `rebate` USDC buying the machine's
// coin and hands the coins to the player. The coin starts on the bonding curve; when the
// curve has taken in 5,000 USDC it graduates and all of it becomes pool liquidity.
// Usage: node coin.mjs

const U0 = 1_250; // virtual USDC
const T0 = 1_000_000_000; // virtual coins
const CURVE = 800_000_000; // coins sold on the curve
const K = U0 * T0;
const TRADE_FEE = 0.01; // on voluntary trades; the rebate buy itself is not charged

class Market {
  constructor() {
    this.reserve = 0;
    this.sold = 0;
    this.live = false; // graduated
    this.pu = 0;
    this.pc = 0;
  }
  price() {
    return this.live ? this.pu / this.pc : (U0 + this.reserve) / (T0 - this.sold);
  }
  graduate() {
    this.live = true;
    this.pu = this.reserve;
    this.pc = (this.pu * (T0 - CURVE)) / (U0 + this.reserve);
  }
  /** Spends `usdc` and returns coins bought. */
  buy(usdc) {
    if (!this.live) {
      const left = CURVE - this.sold;
      const out = T0 - this.sold - K / (U0 + this.reserve + usdc);
      if (out < left) {
        this.reserve += usdc;
        this.sold += out;
        return out;
      }
      const needed = K / (T0 - CURVE) - (U0 + this.reserve);
      this.reserve += needed;
      this.sold = CURVE;
      this.graduate();
      return left + this.buy(usdc - needed);
    }
    const out = this.pc - (this.pu * this.pc) / (this.pu + usdc);
    this.pu += usdc;
    this.pc -= out;
    return out;
  }
  /** Sells `coins` and returns USDC received after the trade fee. */
  sell(coins) {
    let gross;
    if (!this.live) {
      gross = U0 + this.reserve - K / (T0 - this.sold + coins);
      this.reserve -= gross;
      this.sold -= coins;
    } else {
      gross = this.pu - (this.pu * this.pc) / (this.pc + coins);
      this.pu -= gross;
      this.pc += coins;
    }
    return gross * (1 - TRADE_FEE);
  }
}

const usd = (x) => x.toFixed(x < 10 ? 2 : 0);

/**
 * `pulls` pulls on one machine. Each pull's rebate buys coins for that player; a share
 * `sellNow` of players sells them straight away, the rest hold.
 */
function run({ rebate, pulls, sellNow = 0, seed = 7 }) {
  const m = new Market();
  const held = new Float64Array(pulls);
  let gradAt = -1;
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const start = m.price();
  const checkpoints = {};
  for (let i = 0; i < pulls; i++) {
    const coins = m.buy(rebate);
    if (rand() < sellNow) m.sell(coins);
    else held[i] = coins;
    if (gradAt < 0 && m.live) gradAt = i + 1;
    if ([1_000, 5_000, 20_000, 50_000, 100_000].includes(i + 1)) checkpoints[i + 1] = m.price() / start;
  }
  return { m, held, gradAt, start, checkpoints };
}

console.log("== 1. Price path if every player holds the coins they are given ==");
console.log("rebate | graduates after | price multiple at 1k / 5k / 20k / 50k / 100k pulls");
for (const rebate of [0.2, 0.3, 0.4]) {
  const r = run({ rebate, pulls: 100_000 });
  console.log(
    `  ${rebate}  | ${String(r.gradAt).padStart(6)} pulls    | ` +
      [1_000, 5_000, 20_000, 50_000, 100_000].map((c) => `${r.checkpoints[c].toFixed(1)}x`).join(" / "),
  );
}

console.log("\n== 2. Same, when a share of players sells the rebate as soon as they get it (rebate 0.3) ==");
console.log("sell at once | graduates after | price multiple at 5k / 20k / 50k / 100k pulls");
for (const sellNow of [0, 0.5, 0.8, 1]) {
  const r = run({ rebate: 0.3, pulls: 100_000, sellNow });
  console.log(
    `   ${String(sellNow * 100).padStart(3)}%     | ${r.gradAt < 0 ? " never" : String(r.gradAt).padStart(6)} pulls    | ` +
      [5_000, 20_000, 50_000, 100_000].map((c) => `${r.checkpoints[c].toFixed(1)}x`).join(" / "),
  );
}

console.log("\n== 3. Who ends up with the money: 50,000 pulls, everyone holds, then everyone cashes out ==");
for (const rebate of [0.2, 0.3, 0.4]) {
  for (const order of ["earliest players sell first", "latest players sell first"]) {
    const pulls = 50_000;
    const r = run({ rebate, pulls });
    const marked = Array.from(r.held, (c) => c * r.m.price());
    const got = new Float64Array(pulls);
    const idx = Array.from({ length: pulls }, (_, i) => i);
    if (order.startsWith("latest")) idx.reverse();
    for (const i of idx) got[i] = r.m.sell(r.held[i]);
    const decile = (arr, d) => {
      let sum = 0;
      for (let i = (d * pulls) / 10; i < ((d + 1) * pulls) / 10; i++) sum += arr[i];
      return sum / (pulls / 10);
    };
    const total = got.reduce((a, b) => a + b, 0);
    console.log(
      `rebate ${rebate}, ${order}: paid in ${usd(rebate * pulls)}, paper value before selling ${usd(marked.reduce((a, b) => a + b, 0))}, cashed out ${usd(total)}`,
    );
    console.log(
      `    per pull, by when the player pulled (first 10% … last 10%): ` +
        [0, 1, 2, 4, 6, 9].map((d) => `${decile(got, d).toFixed(2)}`).join(" / ") +
        `   (paper: ${[0, 4, 9].map((d) => decile(marked, d).toFixed(2)).join(" / ")})`,
    );
  }
}

console.log("\n== 4. An early player who pulled 20 times in the first 1,000 pulls and sells later (others hold) ==");
for (const rebate of [0.2, 0.3, 0.4]) {
  const row = [];
  for (const sellAt of [2_000, 10_000, 30_000, 100_000]) {
    const r = run({ rebate, pulls: sellAt });
    // 20 pulls spread evenly over the first 1,000
    let coins = 0;
    for (let i = 0; i < 1_000; i += 50) coins += r.held[i];
    row.push(`${usd(r.m.sell(coins))} at ${sellAt / 1000}k`);
  }
  console.log(`rebate ${rebate}: 20 pulls cost 200 USDC, coin rebate bought for ${usd(rebate * 20)} is worth ${row.join(", ")}`);
}

console.log("\n== 5. A late player: 20 pulls starting at pull 40,000, sold right after ==");
for (const rebate of [0.2, 0.3, 0.4]) {
  const r = run({ rebate, pulls: 40_020 });
  let coins = 0;
  for (let i = 40_000; i < 40_020; i++) coins += r.held[i];
  console.log(`rebate ${rebate}: coin rebate bought for ${usd(rebate * 20)} sells for ${r.m.sell(coins).toFixed(2)}`);
}
