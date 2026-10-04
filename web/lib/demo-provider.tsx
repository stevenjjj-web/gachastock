"use client";

// Demo mode: draws and trades in the browser with the same rules as the program and keeps
// state in localStorage. No real funds. The seeded machines and openings are sample data.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { MARKET, OFFICIAL_MACHINES, SEASON, STOCKS, USDC } from "./config";
import { bps, curveBuy, curveSell, drawOne, graduationSplit, poolBuy, poolSell, randomU32Pair } from "./engine";
import { GachaContext } from "./gacha-context";
import { GachaError } from "./i18n";
import type { ClaimAs, CoinInfo, GachaApi, MachineInfo, NewMachine, Opening, Pack } from "./types";

const KEY = "gachastock-demo-v3";
const VRF_DELAY_MS = 2_200;
const FAUCET = 500 * USDC;
const ME = "you";
const DAY = 86_400_000;

type Store = {
  usdc: number;
  dryStreak: number;
  totalSpent: number;
  totalWon: number;
  machines: MachineInfo[];
  packs: Pack[];
  recent: Opening[];
  holdings: Record<string, number>;
};

const emptyCoin = (deadline: number): CoinInfo => ({
  sold: 0,
  marketUsdc: 0,
  poolCoins: 0,
  burned: 0,
  boughtBack: 0,
  buybackPending: 0,
  deadline,
  held: 0,
});

function graduate(m: MachineInfo) {
  const coin = m.coin!;
  const split = graduationSplit(coin.marketUsdc);
  m.prizePool += split.seed;
  coin.marketUsdc = split.poolUsdc;
  coin.poolCoins = split.poolCoins;
  m.status = "live";
}

function buyback(m: MachineInfo) {
  const coin = m.coin!;
  const amount = Math.min(coin.buybackPending, MARKET.maxBuybackPerCrank);
  const coins = poolBuy(coin.marketUsdc, coin.poolCoins, amount);
  coin.buybackPending -= amount;
  coin.marketUsdc += amount;
  coin.poolCoins -= coins;
  coin.burned += coins;
  coin.boughtBack += amount;
}

const fresh = (): Store => {
  const now = Date.now();
  const base = { creatorAccrued: 0, protocolFees: 0, jackpots: 0, mine: false };
  const official = (i: number, prizePool: number, totalPulls: number, jackpots = 0): MachineInfo => ({
    ...base,
    ...OFFICIAL_MACHINES[i],
    id: String(i),
    official: true,
    status: "live",
    creator: "GachaStock",
    prizePool: prizePool * USDC,
    totalPulls,
    volume: totalPulls * SEASON.packPrice,
    jackpots,
  });

  // A graduated launchpad machine with some buyback history
  const mag7: MachineInfo = {
    ...base,
    id: "3",
    official: false,
    status: "curve",
    name: "Mag 7 Mania",
    symbol: "MAG7",
    theme: 0,
    basket: [2, 3, 4, 5, 6],
    creator: "7xKX…9pQe",
    prizePool: 2_340 * USDC,
    totalPulls: 2_410,
    volume: 24_100 * USDC,
    coin: { ...emptyCoin(now - 9 * DAY), sold: MARKET.curveSupply, marketUsdc: MARKET.target },
  };
  graduate(mag7);
  mag7.coin!.buybackPending = 482 * USDC;
  while (mag7.coin!.buybackPending > 12 * USDC) buyback(mag7);

  // Two machines still raising on their curves
  const raising = (id: string, name: string, symbol: string, theme: number, basket: number[], creator: string, raised: number, days: number): MachineInfo => {
    const q = curveBuy(0, 0, Math.floor(raised * USDC * 1.01));
    return {
      ...base,
      id,
      official: false,
      status: "curve",
      name,
      symbol,
      theme,
      basket,
      creator,
      prizePool: 0,
      totalPulls: 0,
      volume: 0,
      coin: { ...emptyCoin(now + days * DAY), sold: q.coinsOut, marketUsdc: q.net },
    };
  };

  const sample: [string, string, number, number, number, number][] = [
    ["8A4b…BPz2", "MAG7", 3, 30, 2, 4],
    ["5x2A…QaNR", "TECH", 0, 5, 3, 11],
    ["HMzN…rS8c", "MAG7", 1, 8, 6, 19],
    ["2iZ2…U4v7", "HOT", 2, 12, 8, 26],
    ["DeME…5uRe", "MAG7", 4, 100, 4, 41],
    ["5Zi4…iwXS", "INDEX", 0, 5, 0, 58],
    ["8A4b…BPz2", "TECH", 1, 8, 3, 73],
  ];
  return {
    usdc: 1_000 * USDC,
    dryStreak: 0,
    totalSpent: 0,
    totalWon: 0,
    machines: [
      official(0, 1_240, 310),
      official(1, 4_820, 3_960, 1),
      official(2, 620, 150),
      mag7,
      raising("4", "Degen Hours", "DEGEN", 3, [7, 8, 9, 10], "Bq4t…m2Lz", 3_100, 3),
      raising("5", "Rate Cut Szn", "CUTS", 6, [0, 1, 4], "3nVw…Xc8h", 600, 6),
    ],
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
    const { s, m } = edit(machineId);
    if (m.status !== "live") throw new GachaError("err.notLive");
    const paid = SEASON.packPrice * count;
    if (s.usdc < paid) throw new GachaError("err.insufficient");
    s.usdc -= paid;
    const pack: Pack = { id: crypto.randomUUID(), machineId, count, paid, status: "pending", pulls: [], lockedAmount: 0, ts: Date.now() };
    s.packs = [pack, ...s.packs];
    commit(s);

    // Simulate the MagicBlock VRF callback delay
    await new Promise((r) => setTimeout(r, VRF_DELAY_MS));

    const { s: t, m: machine } = edit(machineId);
    const p = t.packs.find((x) => x.id === pack.id)!;
    for (let i = 0; i < count; i++) {
      const [roll, stockRoll] = randomU32Pair();
      const res = drawOne(machine, t.dryStreak, roll, stockRoll);
      t.dryStreak = res.dryStreak;
      p.pulls.push(res.pull);
      p.lockedAmount += res.pull.value;
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
    const m = s.machines.find((x) => x.id === p.machineId);
    if (m) m.protocolFees += fee;
    if (as === "usdc") {
      s.usdc += p.lockedAmount - fee;
    } else {
      for (const pull of p.pulls) {
        const stock = STOCKS[pull.stockIdx];
        const net = pull.value - bps(pull.value, SEASON.settleFeeBps);
        s.holdings[stock.ticker] = (s.holdings[stock.ticker] ?? 0) + net / USDC / stock.price;
      }
    }
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
      status: "curve",
      name: n.name,
      symbol: n.symbol,
      theme: n.theme,
      basket: n.basket,
      creator: ME,
      mine: true,
      prizePool: 0,
      totalPulls: 0,
      volume: 0,
      jackpots: 0,
      creatorAccrued: 0,
      protocolFees: MARKET.launchFee,
      coin: emptyCoin(Date.now() + MARKET.saleDays * DAY),
    });
    commit(s);
    return id;
  }, []);

  const coinBuy = useCallback(async (machineId: string, usdc: number) => {
    const { s, m } = edit(machineId);
    const coin = m.coin;
    if (!coin || m.status === "failed" || (m.status === "curve" && Date.now() > coin.deadline)) throw new GachaError("err.marketClosed");
    if (s.usdc < usdc) throw new GachaError("err.insufficient");
    if (m.status === "curve") {
      const q = curveBuy(coin.marketUsdc, coin.sold, usdc);
      if (q.coinsOut <= 0) throw new GachaError("err.tooSmall");
      if (m.mine && coin.held + q.coinsOut > (MARKET.curveSupply * MARKET.creatorMaxPct) / 100) throw new GachaError("err.creatorCap");
      s.usdc -= q.net + q.fee;
      m.protocolFees += q.fee;
      coin.marketUsdc += q.net;
      coin.sold += q.coinsOut;
      coin.held += q.coinsOut;
      // The buy that sells the last curve coin graduates the machine
      if (coin.sold === MARKET.curveSupply) graduate(m);
    } else {
      const fee = bps(usdc, MARKET.tradeFeeBps);
      const out = poolBuy(coin.marketUsdc, coin.poolCoins, usdc - fee);
      if (out <= 0) throw new GachaError("err.tooSmall");
      s.usdc -= usdc;
      m.protocolFees += fee;
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
    if (m.status === "curve" && Date.now() > coin.deadline) m.status = "failed";
    let gross: number;
    if (m.status === "live") {
      gross = poolSell(coin.marketUsdc, coin.poolCoins, coins);
      coin.poolCoins += coins;
    } else {
      gross = curveSell(coin.marketUsdc, coin.sold, coins);
      coin.sold -= coins;
    }
    // A failed launch charges no fee on the way out
    const fee = m.status === "failed" ? 0 : bps(gross, MARKET.tradeFeeBps);
    if (gross - fee <= 0) throw new GachaError("err.tooSmall");
    coin.marketUsdc -= gross;
    coin.held -= coins;
    m.protocolFees += fee;
    s.usdc += gross - fee;
    commit(s);
  }, []);

  const crankBuyback = useCallback(async (machineId: string) => {
    const { s, m } = edit(machineId);
    if (m.status !== "live" || !m.coin || m.coin.buybackPending <= 0) return;
    buyback(m);
    commit(s);
  }, []);

  const withdrawFees = useCallback(async (machineId: string) => {
    const { s, m } = edit(machineId);
    if (m.mine) s.usdc += m.creatorAccrued;
    m.creatorAccrued = 0;
    m.protocolFees = 0;
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
      machines: store.machines,
      packs: store.packs,
      recent: store.recent,
      holdings: store.holdings,
      buy,
      claim,
      launchMachine,
      coinBuy,
      coinSell,
      crankBuyback,
      withdrawFees,
      faucet,
      reset,
    }),
    [store, ready, buy, claim, launchMachine, coinBuy, coinSell, crankBuyback, withdrawFees, faucet, reset],
  );

  return <GachaContext.Provider value={api}>{children}</GachaContext.Provider>;
}
