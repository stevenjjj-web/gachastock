import type { Pull } from "./engine";

export type ClaimAs = "stock" | "usdc";

export type Pack = {
  id: string;
  machineId: string;
  count: number;
  paid: number;
  status: "pending" | "revealed" | "claimed";
  pulls: Pull[];
  lockedAmount: number;
  /** Machine coins the pulls bought for the owner (base units); delivered on claim */
  coins: number;
  ts: number;
  claimedAs?: ClaimAs;
};

/** The coin of a launchpad machine. Amounts are base units (6 decimals). */
export type CoinInfo = {
  mint?: string;
  /** Coins sold on the bonding curve and still outstanding */
  sold: number;
  /** USDC backing the coin: the curve reserve before graduation, the pool's USDC side after */
  marketUsdc: number;
  /** The curve sold out and the coin trades against its pool */
  graduated: boolean;
  /** Coin side of the post-graduation pool */
  poolCoins: number;
  /** Coins that pulls have bought for players, and the USDC that paid for them */
  rebatedCoins: number;
  rebatedUsdc: number;
  /** Coins the connected wallet holds */
  held: number;
};

export type MachineInfo = {
  id: string;
  official: boolean;
  name: string;
  symbol: string;
  theme: number;
  /** Indices into STOCKS */
  basket: number[];
  creator: string;
  /** The connected wallet launched this machine */
  mine: boolean;
  totalPulls: number;
  volume: number;
  jackpots: number;
  creatorAccrued: number;
  coin?: CoinInfo;
};

/** The one prize pool every machine plays for. */
export type PoolInfo = {
  prizePool: number;
  totalPulls: number;
  jackpots: number;
};

export type NewMachine = {
  name: string;
  symbol: string;
  theme: number;
  basket: number[];
};

export type Opening = {
  id: string;
  who: string;
  /** Machine symbol */
  source: string;
  tier: number;
  value: number;
  stockIdx: number;
  ts: number;
};

export type GachaState = {
  mode: "demo" | "chain";
  ready: boolean;
  connected: boolean;
  usdc: number;
  dryStreak: number;
  totalSpent: number;
  totalWon: number;
  pool: PoolInfo;
  machines: MachineInfo[];
  packs: Pack[];
  recent: Opening[];
  /** ticker -> shares (only tracked locally in demo mode) */
  holdings: Record<string, number>;
};

export type GachaApi = GachaState & {
  /** Pays and waits for the VRF callback; resolves with the revealed pack */
  buy(machineId: string, count: number): Promise<Pack>;
  claim(packId: string, as: ClaimAs): Promise<void>;
  /** Launchpad: create a machine and its coin; resolves with the machine id */
  launchMachine(machine: NewMachine): Promise<string>;
  /** Buy the machine coin with at most `usdc` (fee included) */
  coinBuy(machineId: string, usdc: number): Promise<void>;
  /** Sell `coins` of the machine coin */
  coinSell(machineId: string, coins: number): Promise<void>;
  /** Send a machine's accrued creator fees to its creator */
  withdrawFees(machineId: string): Promise<void>;
  /** Chain mode only: open the wallet picker */
  connect?(): void;
  /** Get test USDC (demo mode, or chain mode on devnet) */
  faucet?(): void | Promise<void>;
  reset?(): void;
  /** Chain mode only: full refund after the randomness timeout */
  refund?(packId: string): Promise<void>;
};
