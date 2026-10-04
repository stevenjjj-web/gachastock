// TypeScript mirror of the on-chain draw and market math, used by demo mode and for quotes.
// USDC and coin amounts are integer base units (6 decimals each).

import { FEE_SPLIT, JACKPOT, MARKET, PPM, SEASON, SR, TIERS } from "./config";
import type { MachineInfo } from "./types";

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

/** One pull on a machine. Mutates the machine's ledger and returns the new dry streak. */
export function drawOne(
  m: Pick<MachineInfo, "official" | "basket" | "prizePool" | "totalPulls" | "volume" | "jackpots" | "creatorAccrued" | "protocolFees" | "coin">,
  dryStreak: number,
  roll: number,
  stockRoll: number,
): { pull: Pull; dryStreak: number } {
  const price = SEASON.packPrice;
  const fee = bps(price, SEASON.feeBps);
  const toPool = bps(price, SEASON.poolBps);
  const floor = price - fee - toPool;

  // Launchpad machines share the fee with coin holders (buyback) and the creator
  const buyback = m.official ? 0 : bps(price, FEE_SPLIT.buybackBps);
  const creator = m.official ? 0 : bps(price, FEE_SPLIT.creatorBps);
  m.protocolFees += fee - buyback - creator;
  m.creatorAccrued += creator;
  if (m.coin) m.coin.buybackPending += buyback;
  m.prizePool += toPool;

  let tier = pickTier(roll % PPM);
  if (tier < SR && dryStreak + 1 >= SEASON.pity) tier = SR;
  // Below the activation threshold a jackpot roll falls through to the best affordable tier
  if (tier === JACKPOT && m.prizePool < SEASON.jackpotMinPool) tier = JACKPOT - 1;

  let bonus: number;
  if (tier === JACKPOT) {
    bonus = bps(m.prizePool, SEASON.jackpotShareBps);
    m.jackpots += 1;
  } else {
    const cap = bps(m.prizePool, SEASON.capBps);
    while (tier > 0 && TIERS[tier].bonus > cap) tier -= 1;
    bonus = TIERS[tier].bonus;
  }
  m.prizePool -= bonus;
  m.totalPulls += 1;
  m.volume += price;

  return {
    pull: { tier, value: floor + bonus, stockIdx: m.basket[stockRoll % m.basket.length] },
    dryStreak: tier >= SR ? 0 : dryStreak + 1,
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

/** Buys on the curve with a total budget (fee included); the last buy is filled partially. */
export function curveBuy(reserve: number, sold: number, budget: number): CurveBuy {
  const vu = BigInt(MARKET.virtualUsdc) + BigInt(reserve);
  const vt = BigInt(MARKET.virtualCoins - sold);
  const net = Math.floor((budget * 10_000) / (10_000 + MARKET.tradeFeeBps));
  const newVt = ceilDiv(K, vu + BigInt(net));
  const out = Number(vt > newVt ? vt - newVt : 0n);
  const left = MARKET.curveSupply - sold;
  if (out < left) return { coinsOut: out, net, fee: budget - net };
  const needed = Number(ceilDiv(K, vt - BigInt(left)) - vu);
  return { coinsOut: left, net: needed, fee: Math.min(bps(needed, MARKET.tradeFeeBps) + 1, Math.max(0, budget - needed)) };
}

/** USDC released from the curve reserve for selling coins back, before any fee. */
export function curveSell(reserve: number, sold: number, coinsIn: number): number {
  const vu = BigInt(MARKET.virtualUsdc) + BigInt(reserve);
  const vt = BigInt(MARKET.virtualCoins - sold);
  const newVu = ceilDiv(K, vt + BigInt(coinsIn));
  return Math.min(Number(vu > newVu ? vu - newVu : 0n), reserve);
}

/** Split of the curve reserve at graduation: prize pool seed, pool USDC and pool coins. */
export function graduationSplit(reserve: number) {
  const poolUsdc = reserve - MARKET.seed;
  const vu = BigInt(MARKET.virtualUsdc) + BigInt(reserve);
  const vt = BigInt(MARKET.virtualCoins - MARKET.curveSupply);
  return { seed: MARKET.seed, poolUsdc, poolCoins: Number((BigInt(poolUsdc) * vt) / vu) };
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

type Market = Pick<MachineInfo, "status"> & { coin: NonNullable<MachineInfo["coin"]> };

/** Spot price in USDC per whole coin. */
export function coinPrice(m: Market): number {
  const { coin } = m;
  if (m.status === "live") return coin.poolCoins ? coin.marketUsdc / coin.poolCoins : 0;
  return (MARKET.virtualUsdc + coin.marketUsdc) / (MARKET.virtualCoins - coin.sold);
}

/** What a buy of `usdcIn` (fee included) returns right now. */
export function quoteBuy(m: Market, usdcIn: number): { coins: number; cost: number } {
  if (usdcIn <= 0 || m.status === "failed") return { coins: 0, cost: 0 };
  if (m.status === "curve") {
    const q = curveBuy(m.coin.marketUsdc, m.coin.sold, usdcIn);
    return { coins: q.coinsOut, cost: q.net + q.fee };
  }
  const net = usdcIn - bps(usdcIn, MARKET.tradeFeeBps);
  return { coins: poolBuy(m.coin.marketUsdc, m.coin.poolCoins, net), cost: usdcIn };
}

/** What selling `coinsIn` pays right now, after the fee. A failed launch charges none. */
export function quoteSell(m: Market, coinsIn: number): number {
  if (coinsIn <= 0) return 0;
  if (m.status === "live") {
    const gross = poolSell(m.coin.marketUsdc, m.coin.poolCoins, coinsIn);
    return gross - bps(gross, MARKET.tradeFeeBps);
  }
  if (coinsIn > m.coin.sold) return 0;
  const gross = curveSell(m.coin.marketUsdc, m.coin.sold, coinsIn);
  return m.status === "failed" ? gross : gross - bps(gross, MARKET.tradeFeeBps);
}
