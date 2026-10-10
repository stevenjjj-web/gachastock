// TypeScript mirror of programs/leverage-box/src/math.rs, used for live estimates.
// Products exceed 2^53, so everything runs on BigInt.

import { BOX_TIERS, LONG, SHORT } from "./config";

const PPM = 1_000_000n;
const L = BOX_TIERS.map((t) => BigInt(t.leverage));
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** The leverage tier a random roll draws. */
export function pickTier(roll: number): number {
  let acc = 0;
  for (let i = 0; i < BOX_TIERS.length; i++) {
    acc += BOX_TIERS[i].ppm;
    if (roll % 1_000_000 < acc) return i;
  }
  return 0;
}

/** The side for a new ticket of leverage-weighted stake `w`: the lighter side is more likely. */
export function pickLong(roll: number, wLong: bigint, wShort: bigint, w: bigint): boolean {
  const total = wLong + wShort + w;
  if (total === 0n) return roll % 2 === 0;
  return BigInt(roll) % PPM < ((wShort + w / 2n) * PPM) / total;
}

/** Price move in parts per million, signed. */
export function returnPpm(start: number, end: number): number {
  if (start <= 0) return 0;
  return Number(((BigInt(end) - BigInt(start)) * PPM) / BigInt(start));
}

export type Settlement = { owed: bigint; claimed: bigint; moved: bigint };

/** What the losing side owes, what the winning side claims, and what actually changes hands. */
export function settle(buckets: number[][], rPpm: number): Settlement {
  if (rPpm === 0) return { owed: 0n, claimed: 0n, moved: 0n };
  const abs = BigInt(Math.abs(rPpm));
  const [win, lose] = rPpm > 0 ? [LONG, SHORT] : [SHORT, LONG];
  let owed = 0n;
  let claimed = 0n;
  for (let t = 0; t < L.length; t++) {
    const lost = BigInt(buckets[lose][t]);
    owed += min((lost * L[t] * abs) / PPM, lost);
    claimed += (BigInt(buckets[win][t]) * L[t] * abs) / PPM;
  }
  return { owed, claimed, moved: min(owed, claimed) };
}

/** What one ticket gets back, after the fee on winnings. */
export function payout(stake: number, long: boolean, tier: number, rPpm: number, s: Settlement, feeBps: number): number {
  if (rPpm === 0 || s.moved === 0n) return stake;
  const abs = BigInt(Math.abs(rPpm));
  const st = BigInt(stake);
  if (long === rPpm > 0) {
    const gain = (((st * L[tier] * abs) / PPM) * s.moved) / (s.claimed > 0n ? s.claimed : 1n);
    return Number(st + gain - (gain * BigInt(feeBps)) / 10_000n);
  }
  const liability = min(ceilDiv(st * L[tier] * abs, PPM), st);
  return Number(st - min(ceilDiv(liability * s.moved, s.owed > 0n ? s.owed : 1n), st));
}

/** Leverage-weighted stake on each side: [long, short]. */
export function weights(buckets: number[][]): [number, number] {
  const side = (s: number) => buckets[s].reduce((sum, b, t) => sum + b * BOX_TIERS[t].leverage, 0);
  return [side(LONG), side(SHORT)];
}
