// Season parameters and display config. Values mirror the on-chain program (USDC has 6 decimals).

export const USDC = 1_000_000;
export const COIN = 1_000_000;
export const PPM = 1_000_000;

export const SEASON = {
  packPrice: 10 * USDC,
  feeBps: 800,
  poolBps: 4_200,
  settleFeeBps: 100,
  capBps: 2_500,
  jackpotShareBps: 5_000,
  /** The jackpot only pays while a machine's pool is at least this large */
  jackpotMinPool: 4_000 * USDC,
  pity: 30,
  timeoutSlots: 1_500,
};

/** Launchpad machines carve these out of the fee, as bps of the pack price */
export const FEE_SPLIT = { buybackBps: 200, creatorBps: 100 };

// Machine coin market template, mirrored from programs/kaigu-gacha/src/market.rs
export const MARKET = {
  virtualCoins: 1_000_000_000 * COIN,
  virtualUsdc: 1_250 * USDC,
  curveSupply: 800_000_000 * COIN,
  target: 5_000 * USDC,
  seed: 4_000 * USDC,
  tradeFeeBps: 100,
  launchFee: 10 * USDC,
  saleDays: 7,
  earlyMaxUsdc: 100 * USDC,
  creatorMaxPct: 5,
  maxBuybackPerCrank: 25 * USDC,
};

export const SR = 2;
export const JACKPOT = 6;
export const MAX_BASKET = 8;

export type TierMeta = {
  code: string;
  ppm: number;
  /** Prize-pool payout on top of the floor */
  bonus: number;
  color: string;
  /** Card face gradient */
  from: string;
  to: string;
};

export const TIERS: TierMeta[] = [
  { code: "N", ppm: 630_400, bonus: 0, color: "#8F96B8", from: "#C9CEE3", to: "#8F96B8" },
  { code: "R", ppm: 220_000, bonus: 3 * USDC, color: "#1FC7D4", from: "#7CEAF2", to: "#1FC7D4" },
  { code: "SR", ppm: 120_000, bonus: 7 * USDC, color: "#7645D9", from: "#A881FC", to: "#7645D9" },
  { code: "SSR", ppm: 25_000, bonus: 25 * USDC, color: "#FFB237", from: "#FFE08A", to: "#FF9D00" },
  { code: "UR", ppm: 4_000, bonus: 95 * USDC, color: "#ED4B9E", from: "#FF8AC8", to: "#E0308A" },
  { code: "LR", ppm: 400, bonus: 495 * USDC, color: "#FF5A3C", from: "#FFB15C", to: "#FF3D5E" },
  { code: "JP", ppm: 200, bonus: 0, color: "#7645D9", from: "#53DEE9", to: "#ED4B9E" },
];

export type Stock = {
  ticker: string;
  name: string;
  color: string;
  /** Demo price in USD. Production would read this from Pyth. */
  price: number;
  /** xStocks mint address; fill in after verifying each one before launch */
  mint?: string;
};

// The array index is the position in the on-chain season whitelist
export const STOCKS: Stock[] = [
  { ticker: "SPYx", name: "S&P 500", color: "#2D9CDB", price: 665 },
  { ticker: "QQQx", name: "Nasdaq 100", color: "#00B8A9", price: 602 },
  { ticker: "NVDAx", name: "NVIDIA", color: "#76B900", price: 186 },
  { ticker: "AAPLx", name: "Apple", color: "#6E6E73", price: 256 },
  { ticker: "TSLAx", name: "Tesla", color: "#E31937", price: 438 },
  { ticker: "MSFTx", name: "Microsoft", color: "#0078D4", price: 517 },
  { ticker: "GOOGLx", name: "Alphabet", color: "#F4B400", price: 246 },
  { ticker: "COINx", name: "Coinbase", color: "#0052FF", price: 338 },
  { ticker: "MSTRx", name: "Strategy", color: "#F7931A", price: 322 },
  { ticker: "HOODx", name: "Robinhood", color: "#00C805", price: 141 },
  { ticker: "PLTRx", name: "Palantir", color: "#3D3D4E", price: 182 },
];

/** Pack art colour presets. A machine stores the index on-chain as `theme`. */
export const THEMES = [
  { name: "Gold", from: "#FFE08A", to: "#FF9D00", ink: "#3A2600" },
  { name: "Violet", from: "#B79CFF", to: "#6A3FD0", ink: "#1C0B45" },
  { name: "Teal", from: "#7CEAF2", to: "#0E8C97", ink: "#042E33" },
  { name: "Pink", from: "#FFA3D3", to: "#D82A85", ink: "#42072A" },
  { name: "Lime", from: "#C9F77E", to: "#3FA34D", ink: "#12300F" },
  { name: "Red", from: "#FF9A7A", to: "#D7263D", ink: "#3D0810" },
  { name: "Blue", from: "#8FC2FF", to: "#2D5BFF", ink: "#081A52" },
  { name: "Steel", from: "#EDEBE4", to: "#74777D", ink: "#1B1C1F" },
];

/** The official machines the protocol runs in phase one. */
export const OFFICIAL_MACHINES = [
  { name: "Index Machine", symbol: "INDEX", theme: 2, basket: [0, 1] },
  { name: "Tech Machine", symbol: "TECH", theme: 1, basket: [2, 3, 4, 5, 6] },
  { name: "Trending Machine", symbol: "HOT", theme: 5, basket: [7, 8, 9, 10] },
];

/** What a pack is always worth at least: price minus fee minus the pool share */
export const FLOOR = SEASON.packPrice - (SEASON.packPrice * (SEASON.feeBps + SEASON.poolBps)) / 10_000;

/** A single prize is capped at 25% of the pool, so higher tiers unlock as the pool grows */
export function unlockThreshold(tier: number): number {
  return Math.ceil((TIERS[tier].bonus * 10_000) / SEASON.capBps);
}

export const CHAIN = {
  programId: process.env.NEXT_PUBLIC_PROGRAM_ID ?? "",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com",
  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT ?? "",
  cluster: process.env.NEXT_PUBLIC_CLUSTER ?? "devnet",
};

export const IS_CHAIN_MODE = CHAIN.programId.length > 0;
