"use client";

// Demo mode for Leverage Box. The price is real: MagicBlock's Pyth Lazer feed, read from the
// Ephemeral Rollup without a wallet. Boxes, rounds and settlement run in this browser with the
// program's rules (./math), and simulated players open boxes so a round has two sides. No real
// funds: the arena balance moves in and out of the demo wallet. The first rounds in the history
// are sample data.

import { BN, BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { USDC } from "../config";
import { demoTransfer } from "../demo-provider";
import { GachaError } from "../i18n";
import idl from "../idl/leverage_box.json";
import { ARENA, BOX_TIERS, LONG, SHORT } from "./config";
import { payout, pickLong, pickTier, returnPpm, settle } from "./math";
import type { ArenaApi, ArenaState, PlayerState, RoundResult, Settled, Ticket, Where } from "./use-arena";

// Mirrors the devnet arenas and the program's limits
const OPEN_SECS = 15;
const LIVE_SECS = 30;
const FEE_BPS = 1_000;
const MAX_TICKETS = 8;

const STEP_MS = 250;
const PRICE_MS = 400;
const MAX_SAMPLES = 150;
/** A rollup transaction plus the VRF callback */
const DRAW_MS = 450;
/** Depositing on Solana, or committing the account back to it */
const MOVE_MS = 1_800;
const BOT_STAKES = [5, 10, 10, 25];
/** Used only when the rollup cannot be reached: a random walk from a recent price */
const FALLBACK_PRICE: Record<number, number> = { 6: 110, 1: 82_000, 2: 2_500 };
const KEY = "gachastock-demo-arena-v1";

type Sim = {
  arena: ArenaState;
  feed: PublicKey | null;
  price: number;
  samples: number[];
  failures: number;
  polling: boolean;
  /** Date.now() at which the next simulated player opens a box */
  botAt: number;
  botsLeft: number;
  /** The round the simulated players have joined */
  botRound: number;
};
type MyTicket = Ticket & { feedId: number };
type Me = { balance: number; where: Where; tickets: MyTicket[]; boxes: number; pending: boolean; results: Settled[] };

const PROGRAM_ID = new PublicKey(ARENA.programId);
const coder = new BorshAccountsCoder(idl as Idl);
const arenaKey = (feedId: number) =>
  PublicKey.findProgramAddressSync([Buffer.from("arena"), new BN(feedId).toArrayLike(Buffer, "le", 4)], PROGRAM_ID)[0];
let er: Connection | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roll = () => crypto.getRandomValues(new Uint32Array(1))[0];
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const emptyBuckets = () => [0, 1].map(() => BOX_TIERS.map(() => 0));

const sims = new Map<number, Sim>();
/** How many mounted hooks drive each arena, and how to stop its timers */
const running = new Map<number, number>();
const stoppers = new Map<number, () => void>();
let me: Me = { balance: 0, where: "none", tickets: [], boxes: 0, pending: false, results: [] };
let loaded = false;
let rev = 0;
const listeners = new Set<() => void>();

function emit() {
  rev++;
  if (loaded) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ balance: me.balance, where: me.where, tickets: me.tickets, boxes: me.boxes }));
    } catch {}
  }
  listeners.forEach((l) => l());
}

/** Restores the player. Rounds are not kept, so boxes left in an unfinished round are refunded. */
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Me> | null;
    if (!saved) return;
    const refund = (saved.tickets ?? []).reduce((sum, t) => sum + t.stake, 0);
    const where = saved.where === "moving" ? "rollup" : (saved.where ?? "none");
    me = { ...me, balance: (saved.balance ?? 0) + refund, where, boxes: saved.boxes ?? 0 };
  } catch {}
}

/** A simulated player's box, drawn the way the program draws one. */
function botBox(a: ArenaState) {
  const stake = BOT_STAKES[Math.floor(Math.random() * BOT_STAKES.length)] * USDC;
  addBox(a, stake);
}

/** Draws a side and a tier for a box of `stake` and adds it to the round. */
function addBox(a: ArenaState, stake: number): { long: boolean; tier: number } {
  const tier = pickTier(roll());
  const w = (side: number) => a.buckets[side].reduce((sum, b, t) => sum + BigInt(b) * BigInt(BOX_TIERS[t].leverage), 0n);
  const long = pickLong(roll(), w(LONG), w(SHORT), BigInt(stake) * BigInt(BOX_TIERS[tier].leverage));
  const side = long ? LONG : SHORT;
  a.buckets[side][tier] += stake;
  a.tickets += 1;
  a.staked += stake;
  // The first box of a round starts the countdown to the lock
  if (a.tickets === 1) a.lockAt = Math.floor(Date.now() / 1_000) + OPEN_SECS;
  return { long, tier };
}

/** Settles a round at `endPrice` exactly as `tick` does on chain. */
function result(a: ArenaState, endPrice: number): RoundResult {
  const rPpm = returnPpm(a.startPrice, endPrice);
  const s = settle(a.buckets, rPpm);
  return {
    round: a.round,
    rPpm,
    owed: Number(s.owed),
    claimed: Number(s.claimed),
    moved: Number(s.moved),
    startPrice: a.startPrice,
    endPrice,
    staked: a.staked,
    tickets: a.tickets,
  };
}

function newArena(round: number, history: RoundResult[], volume: number): ArenaState {
  return {
    round,
    open: true,
    tickets: 0,
    staked: 0,
    lockAt: 0,
    endAt: 0,
    startPrice: 0,
    buckets: emptyBuckets(),
    history,
    feeBps: FEE_BPS,
    liveSecs: LIVE_SECS,
    openSecs: OPEN_SECS,
    volume,
  };
}

/** A few finished rounds of sample data, so the history is not empty on first load. */
function seedHistory(price: number): RoundResult[] {
  const rounds: RoundResult[] = [];
  for (let round = 1; round <= 5; round++) {
    const a = newArena(round, [], 0);
    for (let i = Math.floor(rand(4, 10)); i > 0; i--) botBox(a);
    a.startPrice = price;
    const move = Math.round(rand(-1, 1) * rand(20, 400));
    rounds.unshift(result(a, Math.round(price * (1 + move / 1_000_000))));
  }
  return rounds;
}

function simFor(feedId: number): Sim {
  let sim = sims.get(feedId);
  if (!sim) {
    // A new visitor gets time to deposit and start the first round before the simulated players do
    sim = { arena: newArena(6, [], 0), feed: null, price: 0, samples: [], failures: 0, polling: false, botAt: Date.now() + rand(15_000, 20_000), botsLeft: 0, botRound: 0 };
    sims.set(feedId, sim);
  }
  return sim;
}

function setPrice(sim: Sim, p: number) {
  if (!sim.price && !sim.arena.history.length) sim.arena = { ...sim.arena, history: seedHistory(p) };
  sim.price = p;
  sim.samples = sim.samples.length >= MAX_SAMPLES ? [...sim.samples.slice(1), p] : [...sim.samples, p];
}

async function pollPrice(feedId: number) {
  const sim = simFor(feedId);
  if (sim.polling) return;
  sim.polling = true;
  try {
    er ??= new Connection(ARENA.erRpc, "processed");
    if (!sim.feed) {
      const info = await er.getAccountInfo(arenaKey(feedId));
      if (!info) throw new Error("arena not found in the rollup");
      sim.feed = coder.decode<{ feed: PublicKey }>("Arena", info.data).feed;
    }
    const feed = await er.getAccountInfo(sim.feed);
    if (!feed) throw new Error("price feed not found in the rollup");
    setPrice(sim, Number(feed.data.readBigInt64LE(ARENA.priceOffset)));
    sim.failures = 0;
  } catch (e) {
    if (++sim.failures === 3) console.warn("Leverage Box demo: rollup price unavailable, using a random walk", e);
    if (sim.failures >= 3) {
      const last = sim.price || FALLBACK_PRICE[feedId] * 10 ** ARENA.priceDecimals;
      setPrice(sim, Math.round(last * (1 + (Math.random() - 0.5) * 0.00006)));
    }
  } finally {
    sim.polling = false;
  }
  emit();
}

/** Moves the round on and pays out finished tickets, like the page's crank and claim in chain mode. */
function step(feedId: number) {
  const sim = simFor(feedId);
  if (!sim.price) return;
  const a = { ...sim.arena, buckets: sim.arena.buckets.map((b) => [...b]) };
  const now = Date.now() / 1_000;
  let changed = false;
  if (a.open) {
    // Simulated players join each round, whether they start it or the player does
    if (sim.botRound !== a.round && (a.tickets > 0 || Date.now() >= sim.botAt)) {
      sim.botRound = a.round;
      sim.botsLeft = Math.floor(rand(3, 8));
      if (a.tickets > 0) sim.botAt = Date.now() + rand(600, 2_000);
    }
    if (sim.botRound === a.round && sim.botsLeft > 0 && Date.now() >= sim.botAt) {
      botBox(a);
      sim.botsLeft--;
      sim.botAt = Date.now() + rand(900, 2_800);
      changed = true;
    }
    if (a.tickets > 0 && a.lockAt > 0 && now >= a.lockAt) {
      a.open = false;
      a.startPrice = sim.price;
      a.endAt = Math.floor(now) + LIVE_SECS;
      changed = true;
    }
  } else if (now >= a.endAt) {
    const done = result(a, sim.price);
    sim.arena = newArena(a.round + 1, [done, ...a.history].slice(0, 8), a.volume + a.staked);
    sim.botAt = Date.now() + rand(5_000, 9_000);
    claim(feedId);
    emit();
    return;
  }
  if (changed) {
    sim.arena = a;
    emit();
  }
}

/** Credits the player for tickets whose round has settled. */
function claim(feedId: number) {
  const a = simFor(feedId).arena;
  const done = me.tickets.filter((t) => t.feedId === feedId && t.round < a.round);
  if (!done.length) return;
  const settled = new Map<number, Settled>();
  let back = 0;
  for (const t of done) {
    const res = a.history.find((h) => h.round === t.round);
    const got = res
      ? payout(t.stake, t.long, t.tier, res.rPpm, { owed: BigInt(res.owed), claimed: BigInt(res.claimed), moved: BigInt(res.moved) }, a.feeBps)
      : t.stake;
    const row = settled.get(t.round) ?? { round: t.round, staked: 0, returned: 0 };
    row.staked += t.stake;
    row.returned += got;
    settled.set(t.round, row);
    back += got;
  }
  me = {
    ...me,
    balance: me.balance + back,
    tickets: me.tickets.filter((t) => !done.includes(t)),
    results: [...settled.values(), ...me.results].slice(0, 12),
  };
}

function start(feedId: number) {
  load();
  simFor(feedId);
  running.set(feedId, (running.get(feedId) ?? 0) + 1);
  if (running.get(feedId)! > 1) return () => stop(feedId);
  pollPrice(feedId);
  const timers = [setInterval(() => pollPrice(feedId), PRICE_MS), setInterval(() => step(feedId), STEP_MS)];
  stoppers.set(feedId, () => timers.forEach(clearInterval));
  return () => stop(feedId);
}
function stop(feedId: number) {
  const n = (running.get(feedId) ?? 1) - 1;
  running.set(feedId, n);
  if (n <= 0) stoppers.get(feedId)?.();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useDemoArena(feedId: number): ArenaApi {
  const version = useSyncExternalStore(subscribe, () => rev, () => -1);
  useEffect(() => start(feedId), [feedId]);

  const view = useMemo(() => {
    const sim = version < 0 ? null : sims.get(feedId);
    const player: PlayerState | null =
      version < 0 || me.where === "none"
        ? null
        : {
            balance: me.balance,
            pending: me.pending,
            boxes: me.boxes,
            tickets: me.tickets.filter((t) => t.feedId === feedId).map(({ round, stake, long, tier }) => ({ round, stake, long, tier })),
          };
    return {
      arena: sim?.price ? sim.arena : null,
      price: sim?.price ?? 0,
      samples: sim?.samples ?? [],
      player,
      where: version < 0 ? ("none" as Where) : me.where,
      results: version < 0 ? [] : me.results,
    };
  }, [feedId, version]);

  const enter = useCallback(async (amount: number) => {
    demoTransfer(-amount);
    await sleep(MOVE_MS);
    me = { ...me, balance: me.balance + amount, where: "rollup" };
    emit();
  }, []);

  const openBox = useCallback(
    async (stake: number): Promise<Ticket | null> => {
      const sim = simFor(feedId);
      if (!sim.arena.open) throw new GachaError("err.arena.locked");
      if (me.pending) throw new GachaError("err.arena.pending");
      if (me.balance < stake) throw new GachaError("err.arena.balance");
      if (me.tickets.length >= MAX_TICKETS) throw new GachaError("err.arena.tickets");
      const round = sim.arena.round;
      me = { ...me, balance: me.balance - stake, pending: true };
      emit();
      await sleep(DRAW_MS);
      // The round locked while the draw was in flight: the stake comes back
      if (!sim.arena.open || sim.arena.round !== round) {
        me = { ...me, balance: me.balance + stake, pending: false };
        emit();
        return null;
      }
      const a = { ...sim.arena, buckets: sim.arena.buckets.map((b) => [...b]) };
      const { long, tier } = addBox(a, stake);
      sim.arena = a;
      const ticket = { round, stake, long, tier };
      me = { ...me, pending: false, boxes: me.boxes + 1, tickets: [...me.tickets, { ...ticket, feedId }] };
      emit();
      return ticket;
    },
    [feedId],
  );

  const cashOut = useCallback(async () => {
    if (me.tickets.length) throw new GachaError("err.arena.playing");
    me = { ...me, where: "moving" };
    emit();
    await sleep(MOVE_MS);
    demoTransfer(me.balance);
    me = { ...me, balance: 0, where: "solana" };
    emit();
  }, []);

  return { ...view, connected: true, enter, openBox, cashOut };
}
