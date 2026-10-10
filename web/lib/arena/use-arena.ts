"use client";

// Client for Leverage Box. Deposits and withdrawals are wallet-signed transactions on Solana;
// everything in between goes to a MagicBlock Ephemeral Rollup, signed by a session key kept
// in this browser, so playing needs no wallet prompts and costs no fees.

import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHAIN } from "../config";
import { GachaError } from "../i18n";
import idl from "../idl/leverage_box.json";
import type { LeverageBox } from "../idl/leverage_box";
import type { Key } from "../locales/en";
import { ARENA, LONG, PHASE_OPEN } from "./config";
import { payout } from "./math";

const POLL_MS = 400;
const BASE_POLL_MS = 20_000;
const MAX_SAMPLES = 150;
const DRAW_TIMEOUT_MS = 20_000;

export type Ticket = { round: number; stake: number; long: boolean; tier: number };
export type RoundResult = {
  round: number;
  rPpm: number;
  owed: number;
  claimed: number;
  moved: number;
  startPrice: number;
  endPrice: number;
  staked: number;
  tickets: number;
};
export type ArenaState = {
  round: number;
  open: boolean;
  tickets: number;
  staked: number;
  /** Unix seconds; 0 while the round waits for its first box */
  lockAt: number;
  endAt: number;
  startPrice: number;
  /** Stake per side and leverage tier: buckets[side][tier] */
  buckets: number[][];
  /** Finished rounds, newest first */
  history: RoundResult[];
  feeBps: number;
  liveSecs: number;
  openSecs: number;
  volume: number;
};
export type PlayerState = { balance: number; pending: boolean; tickets: Ticket[]; boxes: number };
/** Where the player's account lives right now */
export type Where = "none" | "solana" | "rollup" | "moving";
export type Settled = { round: number; staked: number; returned: number };

type Accounts = Program<LeverageBox>["account"];
type RawArena = Awaited<ReturnType<Accounts["arena"]["fetch"]>>;
type RawPlayer = Awaited<ReturnType<Accounts["player"]["fetch"]>>;

const PROGRAM_ID = new PublicKey(ARENA.programId);
const DELEGATION = new PublicKey(ARENA.delegationProgram);
const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const VAULT = pda(Buffer.from("vault"));
const arenaKey = (feedId: number) => pda(Buffer.from("arena"), new BN(feedId).toArrayLike(Buffer, "le", 4));

const ERRORS: Record<string, Key> = {
  RoundLocked: "err.arena.locked",
  InsufficientBalance: "err.arena.balance",
  TooManyTickets: "err.arena.tickets",
  StillPlaying: "err.arena.playing",
  DrawPending: "err.arena.pending",
};

/** The session key for a wallet: created on first use and kept in this browser only. */
function sessionFor(owner: PublicKey): Keypair {
  const k = `gachastock-arena-session:${owner.toBase58()}`;
  try {
    const saved = localStorage.getItem(k);
    if (saved) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
  } catch {}
  const kp = Keypair.generate();
  try {
    localStorage.setItem(k, JSON.stringify(Array.from(kp.secretKey)));
  } catch {}
  return kp;
}

function toArena(raw: RawArena): ArenaState {
  const n = (x: BN) => x.toNumber();
  const history = raw.history
    .filter((h) => !h.round.isZero())
    .map((h) => ({
      round: n(h.round),
      rPpm: n(h.rPpm),
      owed: n(h.owed),
      claimed: n(h.claimed),
      moved: n(h.moved),
      startPrice: n(h.startPrice),
      endPrice: n(h.endPrice),
      staked: n(h.staked),
      tickets: h.tickets,
    }))
    .sort((a, b) => b.round - a.round);
  return {
    round: n(raw.round),
    open: raw.phase === PHASE_OPEN,
    tickets: raw.tickets,
    staked: n(raw.staked),
    lockAt: n(raw.lockAt),
    endAt: n(raw.endAt),
    startPrice: n(raw.startPrice),
    buckets: raw.buckets.map((side) => side.map(n)),
    history,
    feeBps: raw.feeBps,
    liveSecs: raw.liveSecs,
    openSecs: raw.openSecs,
    volume: n(raw.volume),
  };
}

const toPlayer = (raw: RawPlayer, arena: PublicKey): PlayerState => ({
  balance: raw.balance.toNumber(),
  pending: raw.pending,
  boxes: raw.boxes.toNumber(),
  tickets: raw.tickets
    .filter((t) => t.side !== 0 && t.arena.equals(arena))
    .map((t) => ({ round: t.round.toNumber(), stake: t.stake.toNumber(), long: t.side - 1 === LONG, tier: t.tier })),
});

export function useArena(feedId: number) {
  const { connection: base } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;

  const er = useMemo(() => new Connection(ARENA.erRpc, { commitment: "confirmed", wsEndpoint: ARENA.erRpc.replace(/^http/, "ws") }), []);
  const program = useMemo(
    () => new Program<LeverageBox>(idl as LeverageBox, new AnchorProvider(base, wallet as never, { commitment: "confirmed" })),
    [base, wallet],
  );
  const arenaPk = useMemo(() => arenaKey(feedId), [feedId]);
  const playerPk = useMemo(() => (owner ? pda(Buffer.from("player"), owner.toBuffer()) : null), [owner]);
  // Anyone may move a round on, so every open page does it with a throwaway key
  const crank = useRef<Keypair | null>(null);

  const [arena, setArena] = useState<ArenaState | null>(null);
  const [feed, setFeed] = useState<PublicKey | null>(null);
  const [price, setPrice] = useState(0);
  const [samples, setSamples] = useState<number[]>([]);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [sessionOk, setSessionOk] = useState(false);
  const [where, setWhere] = useState<Where>("none");
  const [results, setResults] = useState<Settled[]>([]);

  // The poll loop and the actions read the latest values from here instead of re-subscribing
  const state = useRef({ arena, where, player, feed, lastTick: 0, claiming: false, busy: false });
  useEffect(() => {
    Object.assign(state.current, { arena, where, player, feed });
  }, [arena, where, player, feed]);

  /** Sends a transaction to the rollup. `signer` is a local key, or null for the wallet. */
  const sendEr = useCallback(
    async (ixs: TransactionInstruction[], signer: Keypair | null) => {
      const tx = new Transaction().add(...ixs);
      tx.feePayer = signer?.publicKey ?? owner!;
      tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
      let raw: Buffer;
      if (signer) {
        tx.sign(signer);
        raw = tx.serialize();
      } else {
        if (!wallet.signTransaction) throw new GachaError("err.signAll");
        raw = (await wallet.signTransaction(tx)).serialize();
      }
      const sig = await er.sendRawTransaction(raw, { skipPreflight: true });
      await er.confirmTransaction(sig, "confirmed");
      const status = (await er.getSignatureStatus(sig)).value;
      if (status?.err) {
        const logs = (await er.getTransaction(sig, { maxSupportedTransactionVersion: 0 }).catch(() => null))?.meta?.logMessages?.join("\n") ?? "";
        const code = /Error Code: (\w+)/.exec(logs)?.[1];
        throw code && ERRORS[code] ? new GachaError(ERRORS[code]) : new Error(`rollup transaction failed: ${JSON.stringify(status.err)}\n${logs}`);
      }
      return sig;
    },
    [er, owner, wallet],
  );

  /** Where the player's account lives is decided by who owns it on Solana. */
  const checkBase = useCallback(async () => {
    if (!playerPk) return;
    const info = await base.getAccountInfo(playerPk);
    if (state.current.busy) return;
    if (!info) {
      setWhere("none");
      setPlayer(null);
    } else if (info.owner.equals(DELEGATION)) {
      setWhere("rollup");
    } else {
      setWhere("solana");
      setPlayer(toPlayer(program.coder.accounts.decode<RawPlayer>("player", info.data), arenaPk));
    }
  }, [arenaPk, base, playerPk, program]);

  // Reset when the wallet or the arena changes, then look the player up on Solana
  useEffect(() => {
    const t = setTimeout(() => {
      setPlayer(null);
      setWhere("none");
      setResults([]);
      checkBase().catch(console.warn);
    }, 0);
    const timer = setInterval(() => checkBase().catch(console.warn), BASE_POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(timer);
    };
  }, [checkBase]);

  // Live state from the rollup: the arena, its price feed and the player, a few times a second
  useEffect(() => {
    let stop = false;
    let inFlight = false;
    const reset = setTimeout(() => {
      setArena(null);
      setFeed(null);
      setSamples([]);
      setPrice(0);
    }, 0);

    const poll = async () => {
      if (inFlight || stop) return;
      inFlight = true;
      try {
        const s = state.current;
        const keys = [arenaPk, ...(s.feed ? [s.feed] : []), ...(playerPk && s.where === "rollup" ? [playerPk] : [])];
        const infos = await er.getMultipleAccountsInfo(keys, "processed");
        if (stop) return;
        const rawArena = infos[0] ? program.coder.accounts.decode<RawArena>("arena", infos[0].data) : null;
        if (!rawArena) return;
        const next = toArena(rawArena);
        setArena(next);
        if (!s.feed) setFeed(rawArena.feed);
        const feedInfo = s.feed ? infos[1] : null;
        if (feedInfo) {
          const p = Number(feedInfo.data.readBigInt64LE(ARENA.priceOffset));
          setPrice(p);
          setSamples((old) => (old.length >= MAX_SAMPLES ? [...old.slice(1), p] : [...old, p]));
        }
        const playerInfo = playerPk && s.where === "rollup" ? infos[s.feed ? 2 : 1] : null;
        let me: PlayerState | null = null;
        if (playerInfo) {
          const raw = program.coder.accounts.decode<RawPlayer>("player", playerInfo.data);
          me = toPlayer(raw, arenaPk);
          setPlayer(me);
          setSessionOk(!!owner && raw.session.equals(sessionFor(owner).publicKey));
        }

        // Move the round on when it is due
        const now = Date.now() / 1_000;
        const due = next.open ? next.tickets > 0 && next.lockAt > 0 && now >= next.lockAt : now >= next.endAt;
        if (due && s.feed && Date.now() - s.lastTick > 1_200) {
          s.lastTick = Date.now();
          crank.current ??= Keypair.generate();
          const ix = await program.methods.tick().accountsPartial({ arena: arenaPk, feed: s.feed }).instruction();
          sendEr([ix], crank.current).catch((e) => console.warn("tick failed", e));
        }

        // Collect finished tickets as soon as their round has settled
        const done = me?.tickets.filter((t) => t.round < next.round) ?? [];
        if (done.length && playerPk && !s.claiming) {
          s.claiming = true;
          const settled = new Map<number, Settled>();
          for (const t of done) {
            const res = next.history.find((h) => h.round === t.round);
            const back = res
              ? payout(t.stake, t.long, t.tier, res.rPpm, { owed: BigInt(res.owed), claimed: BigInt(res.claimed), moved: BigInt(res.moved) }, next.feeBps)
              : t.stake;
            const row = settled.get(t.round) ?? { round: t.round, staked: 0, returned: 0 };
            row.staked += t.stake;
            row.returned += back;
            settled.set(t.round, row);
          }
          crank.current ??= Keypair.generate();
          const ix = await program.methods.claim().accountsPartial({ player: playerPk, arena: arenaPk }).instruction();
          sendEr([ix], crank.current)
            .then(() => setResults((r) => [...settled.values(), ...r].slice(0, 12)))
            .catch((e) => console.warn("claim failed", e))
            .finally(() => (s.claiming = false));
        }
      } catch (e) {
        console.warn("arena poll failed", e);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(reset);
      clearInterval(timer);
    };
  }, [arenaPk, er, owner, playerPk, program, sendEr]);

  const need = useCallback(() => {
    if (!owner || !playerPk) throw new GachaError("err.connect");
    return { owner, playerPk };
  }, [owner, playerPk]);

  /** Runs an action with the background Solana check paused, so it cannot overwrite our state. */
  const exclusive = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    state.current.busy = true;
    try {
      return await fn();
    } finally {
      state.current.busy = false;
    }
  }, []);

  /** Deposits USDC on Solana and delegates the player's account to the rollup, in one approval. */
  const enter = useCallback(
    (amount: number) =>
      exclusive(async () => {
        const { owner, playerPk } = need();
        const mint = new PublicKey(CHAIN.usdcMint);
        const session = sessionFor(owner);
        const delegate = await program.methods
          .delegatePlayer()
          .accountsPartial({ owner, player: playerPk })
          .remainingAccounts([{ pubkey: new PublicKey(ARENA.validator), isSigner: false, isWritable: false }])
          .instruction();
        await program.methods
          .enter(new BN(amount), session.publicKey)
          .accountsPartial({
            owner,
            player: playerPk,
            vault: VAULT,
            ownerUsdc: getAssociatedTokenAddressSync(mint, owner),
            usdcMint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .postInstructions([delegate])
          .rpc();
        setSessionOk(true);
        setWhere("rollup");
      }),
    [exclusive, need, program],
  );

  /** Pays for a box in the rollup and waits for the VRF draw. Resolves with the new ticket. */
  const openBox = useCallback(
    async (stake: number): Promise<Ticket | null> => {
      const { owner, playerPk } = need();
      const before = state.current.player?.boxes ?? 0;
      const ix = await program.methods
        .openBox(new BN(stake), Array.from(crypto.getRandomValues(new Uint8Array(32))))
        .accountsPartial({ signer: sessionOk ? sessionFor(owner).publicKey : owner, player: playerPk, arena: arenaPk, oracleQueue: new PublicKey(ARENA.vrfQueue) })
        .instruction();
      await sendEr([ix], sessionOk ? sessionFor(owner) : null);
      const t0 = Date.now();
      while (Date.now() - t0 < DRAW_TIMEOUT_MS) {
        const info = await er.getAccountInfo(playerPk, "processed");
        const raw = info ? program.coder.accounts.decode<RawPlayer>("player", info.data) : null;
        if (raw && !raw.pending) {
          const me = toPlayer(raw, arenaPk);
          setPlayer(me);
          // No new ticket means the round locked while the draw was in flight and the stake came back
          return raw.boxes.toNumber() > before ? (me.tickets.at(-1) ?? null) : null;
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      throw new GachaError("err.arena.pending");
    },
    [arenaPk, er, need, program, sendEr, sessionOk],
  );

  /** Brings the account back to Solana and withdraws the whole balance to the wallet. */
  const cashOut = useCallback(
    () =>
      exclusive(async () => {
        const { owner, playerPk } = need();
        if (state.current.where === "rollup") {
          const ix = await program.methods.leave().accountsPartial({ signer: sessionOk ? sessionFor(owner).publicKey : owner, player: playerPk }).instruction();
          await sendEr([ix], sessionOk ? sessionFor(owner) : null);
          setWhere("moving");
          const t0 = Date.now();
          for (;;) {
            const info = await base.getAccountInfo(playerPk);
            if (info?.owner.equals(PROGRAM_ID)) break;
            if (Date.now() - t0 > 90_000) throw new GachaError("err.action");
            await new Promise((r) => setTimeout(r, 1_500));
          }
        }
        const mint = new PublicKey(CHAIN.usdcMint);
        await program.methods
          .withdraw()
          .accountsPartial({ owner, player: playerPk, vault: VAULT, ownerUsdc: getAssociatedTokenAddressSync(mint, owner), usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID })
          .rpc();
        setWhere("solana");
        setPlayer((p) => (p ? { ...p, balance: 0, tickets: [] } : p));
      }).finally(() => checkBase().catch(console.warn)),
    [base, checkBase, exclusive, need, program, sendEr, sessionOk],
  );

  return { arena, price, samples, player, where, results, connected: !!owner, enter, openBox, cashOut };
}
