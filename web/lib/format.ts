import { USDC } from "./config";

export const usd = (micro: number, digits = 2) =>
  (micro / USDC).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Whole dollars when the amount is whole, cents otherwise. */
export const usdAuto = (micro: number) => usd(micro, micro % USDC === 0 ? 0 : 2);

export const usd0 = (micro: number) => usd(micro, 0);

export const shares = (n: number) =>
  n >= 1 ? n.toFixed(3) : n >= 0.01 ? n.toFixed(4) : n.toFixed(5);

/** Compact duration such as 45s, 12m, 3h or 2d. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3_600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}
