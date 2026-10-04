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
  ts: number;
  claimedAs?: ClaimAs;
};

export type MachineStatus = "curve" | "live" | "failed";

/** The coin of a launchpad machine. Amounts are base units (6 decimals). */
export type CoinInfo = {
  mint?: string;
  /** Coins sold on the bonding curve and still outstanding */
  sold: number;
  /** USDC backing the coin: the curve reserve before graduation, the pool's USDC side after */
  marketUsdc: number;
  /** Coin side of the post-graduation pool */
  poolCoins: number;
  burned: number;
  boughtBack: number;
  /** Fees accrued for the next buyback */
  buybackPending: number;
  /** Unix ms; the curve must sell out before this */
  deadline: number;
  /** Coins the connected wallet holds */
  held: number;
};

export type MachineInfo = {
  id: string;
  official: boolean;
  status: MachineStatus;
  name: string;
  symbol: string;
  theme: number;
  /** Indices into STOCKS */
  basket: number[];
  creator: string;
  /** The connected wallet launched this machine */
  mine: boolean;
  prizePool: number;
  totalPulls: number;
  volume: number;
  jackpots: number;
  creatorAccrued: number;
  protocolFees: number;
  coin?: CoinInfo;
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
  /** Spend accrued fees on a buyback and burn; anyone can call it */
  crankBuyback(machineId: string): Promise<void>;
  /** Send accrued fees to the creator and the treasury */
  withdrawFees(machineId: string): Promise<void>;
  /** Chain mode only: open the wallet picker */
  connect?(): void;
  /** Get test USDC (demo mode, or chain mode on devnet) */
  faucet?(): void | Promise<void>;
  reset?(): void;
  /** Chain mode only: full refund after the randomness timeout */
  refund?(packId: string): Promise<void>;
};
