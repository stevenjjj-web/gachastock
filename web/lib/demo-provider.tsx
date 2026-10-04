"use client";

// Demo mode: draws and trades in the browser with the same rules as the program and keeps
// state in localStorage. No real funds. The seeded machines and openings are sample data.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { FEE_SPLIT, MARKET, OFFICIAL_MACHINES, SEASON, STOCKS, USDC } from "./config";
import { bps, buyExact, curveBuy, curveSell, drawOne, graduate, poolBuy, poolSell, randomU32Pair } from "./engine";
import { GachaContext } from "./gacha-context";
import { GachaError } from "./i18n";
import type { ClaimAs, CoinInfo, GachaApi, MachineInfo, NewMachine, Opening, Pack, PoolInfo } from "./types";

const KEY = "gachastock-demo-v4";
const VRF_DELAY_MS = 2_200;
const FAUCET = 500 * USDC;
const ME = "you";

type Store = {
  usdc: number;
  dryStreak: number;
  totalSpent: number;
  totalWon: number;
  pool: PoolInfo;
  machines: MachineInfo[];
  packs: Pack[];
  recent: Opening[];
  holdings: Record<string, number>;
};

const emptyCoin = (): CoinInfo => ({
  sold: 0,
  marketUsdc: 0,
  graduated: false,
  poolCoins: 0,
  rebatedCoins: 0,
  rebatedUsdc: 0,
  held: 0,
});

const fresh = (): Store => {
  const now = Date.now();
  const base = { creatorAccrued: 0, jackpots: 0, mine: false };
  const official = (i: number, totalPulls: number, jackpots = 0): MachineInfo => ({
    ...base,
    ...OFFICIAL_MACHINES[i],
    id: String(i),
    official: true,
    creator: "GachaStock",
    totalPulls,
    volume: totalPulls * SEASON.packPrice,
    jackpots,
  });

  // A launchpad machine with `pulls` pulls behind it, plus `bought` USDC of direct coin buys
  const launchpad = (id: string, name: string, symbol: string, theme: number, basket: number[], creator: string, pulls: number, bought = 0): MachineInfo => {
    const coin = emptyCoin();
    coin.rebatedUsdc = pulls * bps(SEASON.packPrice, FEE_SPLIT.rebateBps);
    coin.rebatedCoins = buyExact(coin, coin.rebatedUsdc);
    if (bought) buyExact(coin, bought * USDC);
    return {
      ...base,
      id,
      official: false,
      name,
      symbol,
      theme,
      basket,
      creator,
      totalPulls: pulls,
      volume: pulls * SEASON.packPrice,
      creatorAccrued: 0,
      coin,
    };
  };

  const sample: [string, string, number, number, number, number][] = [
    ["8A4b…BPz2", "MAG7", 3, 40, 2, 4],
    ["5x2A…QaNR", "TECH", 0, 7.5, 3, 11],
    ["HMzN…rS8c", "MAG7", 1, 11, 6, 19],
    ["2iZ2…U4v7", "HOT", 2, 25, 8, 26],
    ["DeME…5uRe", "DEGEN", 4, 100, 9, 41],
    ["5Zi4…iwXS", "INDEX", 0, 7.5, 0, 58],
    ["8A4b…BPz2", "TECH", 1, 11, 3, 73],
  ];
  const machines = [
    official(0, 6_310),
    official(1, 14_960, 2),
    official(2, 3_150),
    launchpad("3", "Mag 7 Mania", "MAG7", 0, [2, 3, 4, 5, 6], "7xKX…9pQe", 21_400, 0),
    launchpad("4", "Degen Hours", "DEGEN", 3, [7, 8, 9, 10], "Bq4t…m2Lz", 3_100, 800),
    launchpad("5", "Rate Cut Szn", "CUTS", 6, [0, 1, 4], "3nVw…Xc8h", 240),
  ];
  machines[3].jackpots = 1;
  return {
    usdc: 1_000 * USDC,
    dryStreak: 0,
    totalSpent: 0,
    totalWon: 0,
    pool: { prizePool: 6_420 * USDC, totalPulls: machines.reduce((n, m) => n + m.totalPulls, 0), jackpots: 3 },
    machines,
    packs: [],
    recent: sample.map(([who, source, tier, value, stockIdx, minsAgo], i) => ({
      id: `s${i}`,
      who,
      source,
      tier,
      value: value * USDC,
      stockIdx,
      ts: now - minsAgo * 60_000,
    })),
    holdings: {},
  };
};

// External store: restored from localStorage on first read
const SERVER = fresh();
let current: Store | null = null;
const listeners = new Set<() => void>();

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const saved = JSON.parse(raw) as Store;
    // Packs that never got their callback last time are treated as timed-out refunds
    for (const p of saved.packs.filter((x) => x.status === "pending")) saved.usdc += p.paid;
    saved.packs = saved.packs.filter((p) => p.status !== "pending");
    return saved;
  } catch {
    return fresh();
  }
}

const getStore = () => (current ??= load());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
function commit(next: Store) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
}

/** Clones the store and hands back the machine to work on. */
function edit(machineId: string) {
  const s = structuredClone(getStore());
  const m = s.machines.find((x) => x.id === machineId);
  if (!m) throw new GachaError("err.action");
  return { s, m };
}

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const store = useSyncExternalStore(subscribe, getStore, () => SERVER);
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const buy = useCallback(async (machineId: string, count: number): Promise<Pack> => {
    const { s } = edit(machineId);
    const paid = SEASON.packPrice * count;
    if (s.usdc < paid) throw new GachaError("err.insufficient");
    s.usdc -= paid;
    const pack: Pack = { id: crypto.randomUUID(), machineId, count, paid, status: "pending", pulls: [], lockedAmount: 0, coins: 0, ts: Date.now() };
    s.packs = [pack, ...s.packs];
    commit(s);

    // Simulate the MagicBlock VRF callback delay
    await new Promise((r) => setTimeout(r, VRF_DELAY_MS));

    const { s: t, m: machine } = edit(machineId);
    const p = t.packs.find((x) => x.id === pack.id)!;
    for (let i = 0; i < count; i++) {
      const [roll, stockRoll] = randomU32Pair();
      const res = drawOne(t.pool, machine, t.dryStreak, roll, stockRoll);
      t.dryStreak = res.dryStreak;
      p.pulls.push(res.pull);
      p.lockedAmount += res.pull.value;
      p.coins += res.coins;
    }
    p.status = "revealed";
    t.totalSpent += paid;
    t.totalWon += p.lockedAmount;
    const now = Date.now();
    t.recent = [
      ...p.pulls.map((x, i) => ({ id: `${p.id}-${i}`, who: ME, source: machine.symbol, tier: x.tier, value: x.value, stockIdx: x.stockIdx, ts: now })),
      ...t.recent,
    ].slice(0, 30);
    commit(t);
    return structuredClone(p);
  }, []);

  const claim = useCallback(async (packId: string, as: ClaimAs) => {
    const s = structuredClone(getStore());
    const p = s.packs.find((x) => x.id === packId);
    if (!p || p.status !== "revealed") return;
    const fee = bps(p.lockedAmount, SEASON.settleFeeBps);
    if (as === "usdc") {
      s.usdc += p.lockedAmount - fee;
    } else {
      for (const pull of p.pulls) {
        const stock = STOCKS[pull.stockIdx];
        const net = pull.value - bps(pull.value, SEASON.settleFeeBps);
        s.holdings[stock.ticker] = (s.holdings[stock.ticker] ?? 0) + net / USDC / stock.price;
      }
    }
    // The coins the pulls bought are delivered with the claim
    const coin = s.machines.find((x) => x.id === p.machineId)?.coin;
    if (coin) coin.held += p.coins;
    p.status = "claimed";
    p.claimedAs = as;
    s.packs = s.packs.slice(0, 40);
    commit(s);
  }, []);

  const launchMachine = useCallback(async (n: NewMachine) => {
    const s = structuredClone(getStore());
    if (s.usdc < MARKET.launchFee) throw new GachaError("err.insufficient");
    s.usdc -= MARKET.launchFee;
    const id = `u${Date.now().toString(36)}`;
    s.machines.push({
      id,
      official: false,
      name: n.name,
      symbol: n.symbol,
      theme: n.theme,
      basket: n.basket,
      creator: ME,
      mine: true,
      totalPulls: 0,
      volume: 0,
      jackpots: 0,
      creatorAccrued: 0,
      coin: emptyCoin(),
    });
    commit(s);
    return id;
  }, []);

  const coinBuy = useCallback(async (machineId: string, usdc: number) => {
    const { s, m } = edit(machineId);
    const coin = m.coin;
    if (!coin) throw new GachaError("err.marketClosed");
    if (s.usdc < usdc) throw new GachaError("err.insufficient");
    if (!coin.graduated) {
      const q = curveBuy(coin.marketUsdc, coin.sold, usdc);
      if (q.coinsOut <= 0) throw new GachaError("err.tooSmall");
      if (m.mine && coin.held + q.coinsOut > (MARKET.curveSupply * MARKET.creatorMaxPct) / 100) throw new GachaError("err.creatorCap");
      s.usdc -= q.net + q.fee;
      coin.marketUsdc += q.net;
      coin.sold += q.coinsOut;
      coin.held += q.coinsOut;
      // The buy that sells the last curve coin graduates the coin
      if (coin.sold === MARKET.curveSupply) graduate(coin);
    } else {
      const fee = bps(usdc, MARKET.tradeFeeBps);
      const out = poolBuy(coin.marketUsdc, coin.poolCoins, usdc - fee);
      if (out <= 0) throw new GachaError("err.tooSmall");
      s.usdc -= usdc;
      coin.marketUsdc += usdc - fee;
      coin.poolCoins -= out;
      coin.held += out;
    }
    commit(s);
  }, []);

  const coinSell = useCallback(async (machineId: string, coins: number) => {
    const { s, m } = edit(machineId);
    const coin = m.coin;
    if (!coin) throw new GachaError("err.marketClosed");
    if (coins <= 0 || coins > coin.held) throw new GachaError("err.noCoins");
    let gross: number;
    if (coin.graduated) {
      gross = poolSell(coin.marketUsdc, coin.poolCoins, coins);
      coin.poolCoins += coins;
    } else {
      gross = curveSell(coin.marketUsdc, coin.sold, coins);
      coin.sold -= coins;
    }
    const fee = bps(gross, MARKET.tradeFeeBps);
    if (gross - fee <= 0) throw new GachaError("err.tooSmall");
    coin.marketUsdc -= gross;
    coin.held -= coins;
    s.usdc += gross - fee;
    commit(s);
  }, []);

  const withdrawFees = useCallback(async (machineId: string) => {
    const { s, m } = edit(machineId);
    if (m.mine) s.usdc += m.creatorAccrued;
    m.creatorAccrued = 0;
    commit(s);
  }, []);

  const faucet = useCallback(() => {
    const s = structuredClone(getStore());
    s.usdc += FAUCET;
    commit(s);
  }, []);

  const reset = useCallback(() => commit(fresh()), []);

  const api = useMemo<GachaApi>(
    () => ({
      mode: "demo",
      ready,
      connected: true,
      usdc: store.usdc,
      dryStreak: store.dryStreak,
      totalSpent: store.totalSpent,
      totalWon: store.totalWon,
      pool: store.pool,
      machines: store.machines,
      packs: store.packs,
      recent: store.recent,
      holdings: store.holdings,
      buy,
      claim,
      launchMachine,
      coinBuy,
      coinSell,
      withdrawFees,
      faucet,
      reset,
    }),
    [store, ready, buy, claim, launchMachine, coinBuy, coinSell, withdrawFees, faucet, reset],
  );

  return <GachaContext.Provider value={api}>{children}</GachaContext.Provider>;
}
