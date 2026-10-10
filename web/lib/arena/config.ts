// Leverage Box: the real-time mode that runs in a MagicBlock Ephemeral Rollup.
// Values mirror programs/leverage-box.

import idl from "../idl/leverage_box.json";

export const ARENA = {
  programId: idl.address,
  /** MagicBlock's public devnet rollup endpoint and the validator accounts are delegated to */
  erRpc: process.env.NEXT_PUBLIC_ER_RPC_URL ?? "https://devnet-as.magicblock.app",
  validator: "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
  /** MagicBlock VRF queue for Ephemeral Rollups */
  vrfQueue: "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
  delegationProgram: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
  /** Pyth Lazer prices are stored with 8 decimals */
  priceDecimals: 8,
  priceOffset: 73,
};

export type Asset = { symbol: string; name: string; feedId: number; color: string; digits: number };

/** One arena per asset; `feedId` is the Pyth Lazer feed MagicBlock's oracle pushes into the rollup. */
export const ASSETS: Asset[] = [
  { symbol: "SOL", name: "Solana", feedId: 6, color: "#9945FF", digits: 3 },
  { symbol: "BTC", name: "Bitcoin", feedId: 1, color: "#F7931A", digits: 1 },
  { symbol: "ETH", name: "Ethereum", feedId: 2, color: "#8C9EFF", digits: 2 },
];

export const LONG = 0;
export const SHORT = 1;
export const PHASE_OPEN = 0;

/** Leverage tiers a box can roll, rarest last. A weight, not a promised multiple. */
export const BOX_TIERS = [
  { leverage: 500, ppm: 400_000, from: "#C9CEE3", to: "#8F96B8" },
  { leverage: 1_000, ppm: 300_000, from: "#7CEAF2", to: "#1FC7D4" },
  { leverage: 2_500, ppm: 180_000, from: "#A881FC", to: "#7645D9" },
  { leverage: 5_000, ppm: 90_000, from: "#FFE08A", to: "#FF9D00" },
  { leverage: 10_000, ppm: 30_000, from: "#FF8AC8", to: "#E0308A" },
];

/** Stake and deposit presets, in whole USDC */
export const STAKES = [5, 10, 25];
export const DEPOSITS = [50, 100, 250];
