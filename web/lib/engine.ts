// TypeScript mirror of the on-chain draw and market math, used by demo mode and for quotes.
// USDC and coin amounts are integer base units (6 decimals each).

import { FEE_SPLIT, JACKPOT, MARKET, PPM, SEASON, SR, TIERS } from "./config";
import type { CoinInfo, MachineInfo, PoolInfo } from "./types";

export type Pull = { tier: number; value: number; stockIdx: number };

export const bps = (amount: number, b: number) => Math.floor((amount * b) / 10_000);

export function pickTier(roll: number): number {
  let acc = 0;
  for (let i = 0; i < TIERS.length; i++) {
    acc += TIERS[i].ppm;
    if (roll < acc) return i;
  }
  return 0;
}

/** Where one pack price goes on a launchpad or an official machine. */
export function split(official: boolean) {
  const price = SEASON.packPrice;
  const fee = bps(price, SEASON.feeBps);
  const toPool = bps(price, SEASON.poolBps);
  const floor = price - fee - toPool;
  const rebate = bps(price, FEE_SPLIT.rebateBps);
  const creator = bps(price, FEE_SPLIT.creatorBps);
  const rest = fee - rebate - creator;
  // Official machines have no coin and no creator: the coin share feeds the prize pool
  return official
    ? { floor, pool: toPool + rebate, rebate: 0, creator: 0, protocol: rest + creator }
    : { floor, pool: toPool, rebate, creator, protocol: rest };
}

/**
 * One pull on a machine. Mutates the shared pool and the machine, and returns the pull, the
 * machine coins it bought for the player and the new dry streak.
 */
export function drawOne(
  pool: PoolInfo,
  m: Pick<MachineInfo, "official" | "basket" | "totalPulls" | "volume" | "jackpots" | "creatorAccrued" | "coin">,
  dryStreak: number,
  roll: number,
  stockRoll: number,
): { pull: Pull; coins: number; dryStreak: number } {
  const sp = split(m.official);
  pool.prizePool += sp.pool;
  m.creatorAccrued += sp.creator;
  const coins = m.coin && sp.rebate > 0 ? buyExact(m.coin, sp.rebate) : 0;
  if (m.coin) {
    m.coin.rebatedCoins += coins;
    m.coin.rebatedUsdc += sp.rebate;
  }

  let tier = pickTier(roll % PPM);
  const pity = tier < SR && dryStreak + 1 >= SEASON.pity;
  if (pity) tier = SR;
  // Below the activation threshold a jackpot roll falls through to the best affordable tier
  if (tier === JACKPOT && pool.prizePool < SEASON.jackpotMinPool) tier = JACKPOT - 1;

  let bonus: number;
  if (tier === JACKPOT) {
    bonus = bps(pool.prizePool, SEASON.jackpotShareBps);
    pool.jackpots += 1;
    m.jackpots += 1;
  } else {
    const cap = bps(pool.prizePool, SEASON.capBps);
    while (tier > 0 && TIERS[tier].bonus > cap) tier -= 1;
    bonus = TIERS[tier].bonus;
  }
  pool.prizePool -= bonus;
  pool.totalPulls += 1;
  m.totalPulls += 1;
  m.volume += SEASON.packPrice;

  return {
    pull: { tier, value: sp.floor + bonus, stockIdx: m.basket[stockRoll % m.basket.length] },
    coins,
    // A pity pull uses up the guarantee even when the cap downgrades it
    dryStreak: tier >= SR || pity ? 0 : dryStreak + 1,
  };
}

export function randomU32Pair(): [number, number] {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return [a[0], a[1]];
}

// ---- Machine coin market: mirror of programs/kaigu-gacha/src/market.rs ----
// The products overflow a double, so the invariant math runs on BigInt.

const K = BigInt(MARKET.virtualCoins) * BigInt(MARKET.virtualUsdc);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export type CurveBuy = { coinsOut: number; net: number; fee: number };

/** Coins the curve gives for adding `net` to its reserve, and the USDC it actually takes. */
function curveFill(reserve: number, sold: number, net: number): [number, number] {
  const vu = BigInt(MARKET.virtualUsdc) + BigInt(reserve);
  const vt = BigInt(MARKET.virtualCoins - sold);
  const newVt = ceilDiv(K, vu + BigInt(net));
  const out = Number(vt > newVt ? vt - newVt : 0n);
  const left = MARKET.curveSupply - sold;
  if (out < left) return [out, net];
  return [left, Number(ceilDiv(K, vt - BigInt(left)) - vu)];
}

/** Buys on the curve with a total budget (fee included); the last buy is filled partially. */
export function curveBuy(reserve: number, sold: number, budget: number): CurveBuy {
  const net = Math.floor((budget * 10_000) / (10_000 + MARKET.tradeFeeBps));
  const [coinsOut, used] = curveFill(reserve, sold, net);
  const fee = used === net ? budget - net : Math.min(bps(used, MARKET.tradeFeeBps) + 1, Math.max(0, budget - used));
  return { coinsOut, net: used, fee };
}

/** USDC released from the curve reserve for selling coins back, before any fee. */
export function curveSell(reserve: number, sold: number, coinsIn: number): number {
  const vu = BigInt(MARKET.virtualUsdc) + BigInt(reserve);
  const vt = BigInt(MARKET.virtualCoins - sold);
  const newVu = ceilDiv(K, vt + BigInt(coinsIn));
  return Math.min(Number(vu > newVu ? vu - newVu : 0n), reserve);
}

/** Coin side of the pool at graduation: the whole reserve at the curve's final price. */
export function graduationPoolCoins(reserve: number): number {
  const vu = BigInt(MARKET.virtualUsdc) + BigInt(reserve);
  const vt = BigInt(MARKET.virtualCoins - MARKET.curveSupply);
  return Number((BigInt(reserve) * vt) / vu);
}

/** Switches a sold-out curve over to its pool. */
export function graduate(coin: CoinInfo) {
  coin.poolCoins = graduationPoolCoins(coin.marketUsdc);
  coin.graduated = true;
}

export function poolBuy(poolUsdc: number, poolCoins: number, usdcIn: number): number {
  const k = BigInt(poolUsdc) * BigInt(poolCoins);
  const newCoins = ceilDiv(k, BigInt(poolUsdc) + BigInt(usdcIn));
  return Number(BigInt(poolCoins) > newCoins ? BigInt(poolCoins) - newCoins : 0n);
}

export function poolSell(poolUsdc: number, poolCoins: number, coinsIn: number): number {
  const k = BigInt(poolUsdc) * BigInt(poolCoins);
  const newUsdc = ceilDiv(k, BigInt(poolCoins) + BigInt(coinsIn));
  return Number(BigInt(poolUsdc) > newUsdc ? BigInt(poolUsdc) - newUsdc : 0n);
}

/**
 * Spends exactly `usdc` on the coin with no fee, wherever it trades right now, and returns the
 * coins bought. This is how a pull buys the coin for its player; it can graduate the coin.
 */
export function buyExact(coin: CoinInfo, usdc: number): number {
  let left = usdc;
  let coins = 0;
  if (!coin.graduated) {
    const [out, used] = curveFill(coin.marketUsdc, coin.sold, left);
    coin.marketUsdc += used;
    coin.sold += out;
    coins = out;
    left -= used;
    if (coin.sold < MARKET.curveSupply) return coins;
    graduate(coin);
  }
  const out = poolBuy(coin.marketUsdc, coin.poolCoins, left);
  coin.marketUsdc += left;
  coin.poolCoins -= out;
  return coins + out;
}

type Market = Pick<CoinInfo, "sold" | "marketUsdc" | "graduated" | "poolCoins">;

/** Spot price in USDC per whole coin. */
export function coinPrice(coin: Market): number {
  if (coin.graduated) return coin.poolCoins ? coin.marketUsdc / coin.poolCoins : 0;
  return (MARKET.virtualUsdc + coin.marketUsdc) / (MARKET.virtualCoins - coin.sold);
}

/** What a buy of `usdcIn` (fee included) returns right now. */
export function quoteBuy(coin: Market, usdcIn: number): { coins: number; cost: number } {
  if (usdcIn <= 0) return { coins: 0, cost: 0 };
  if (!coin.graduated) {
    const q = curveBuy(coin.marketUsdc, coin.sold, usdcIn);
    return { coins: q.coinsOut, cost: q.net + q.fee };
  }
  const net = usdcIn - bps(usdcIn, MARKET.tradeFeeBps);
  return { coins: poolBuy(coin.marketUsdc, coin.poolCoins, net), cost: usdcIn };
}

/** What selling `coinsIn` pays right now, after the fee. */
export function quoteSell(coin: Market, coinsIn: number): number {
  if (coinsIn <= 0) return 0;
  if (!coin.graduated && coinsIn > coin.sold) return 0;
  const gross = coin.graduated ? poolSell(coin.marketUsdc, coin.poolCoins, coinsIn) : curveSell(coin.marketUsdc, coin.sold, coinsIn);
  return gross - bps(gross, MARKET.tradeFeeBps);
}

/** Coins one pull's rebate buys right now, without changing anything. */
export function quoteRebate(coin: Market): number {
  return buyExact({ ...coin, rebatedCoins: 0, rebatedUsdc: 0, held: 0 }, bps(SEASON.packPrice, FEE_SPLIT.rebateBps));
}
