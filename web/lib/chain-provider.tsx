"use client";

// Chain mode: enabled when NEXT_PUBLIC_PROGRAM_ID is set. Covers pulls on machines
// (buy → VRF callback → claim), the shared prize pool, the launchpad and machine coin trading.

import { AnchorProvider, BN, EventParser, Program } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ConnectionProvider, useConnection, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import { useWalletModal, WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHAIN, MACHINE_ACCOUNT_SIZE, MARKET, SEASON, STOCKS } from "./config";
import { bps, quoteBuy, quoteSell } from "./engine";
import { GachaContext } from "./gacha-context";
import { GachaError } from "./i18n";
import idl from "./idl/kaigu_gacha.json";
import type { KaiguGacha } from "./idl/kaigu_gacha";
import type { Key } from "./locales/en";
import type { ClaimAs, GachaApi, GachaState, MachineInfo, NewMachine, Opening, Pack } from "./types";

// MagicBlock VRF base-layer queue (same address on mainnet and devnet)
const ORACLE_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
const REVEAL_TIMEOUT_MS = 90_000;
// The public devnet RPC rate-limits hard, so keep background reads sparse
const REFRESH_MS = 15_000;
const RECENT_TX_LIMIT = 8;
const PACK_SCAN_EVERY = 20;
const MAX_MACHINES = 30;
const MAX_PACKS = 10;
// Quotes move between reading the state and landing the transaction
const SLIPPAGE_BPS = 300;

const programId = () => new PublicKey(CHAIN.programId);
const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, programId())[0];
const u16le = (n: number) => new BN(n).toArrayLike(Buffer, "le", 2);
const u64le = (n: BN) => n.toArrayLike(Buffer, "le", 8);
const short = (k: PublicKey | string) => {
  const a = typeof k === "string" ? k : k.toBase58();
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
};

/** The shared vault: its ledger account and the one USDC account of the program. */
const vaultAccounts = () => ({ vault: pda(Buffer.from("prize_vault")), vaultToken: pda(Buffer.from("prize_vault_token")) });

function machineAccounts(id: string) {
  const machine = pda(Buffer.from("machine"), u64le(new BN(id)));
  return {
    machine,
    curve: pda(Buffer.from("curve"), machine.toBuffer()),
    coinMint: pda(Buffer.from("coin"), machine.toBuffer()),
  };
}

type Accounts = Program<KaiguGacha>["account"];
type RawPack = Awaited<ReturnType<Accounts["pack"]["fetch"]>>;
type RawMachine = Awaited<ReturnType<Accounts["machine"]["fetch"]>>;
type RawCurve = Awaited<ReturnType<Accounts["curve"]["fetch"]>>;
type RawVault = Awaited<ReturnType<Accounts["vault"]["fetch"]>>;

function toPack(key: PublicKey, raw: RawPack, machineId: string): Pack {
  const revealed = "revealed" in raw.status;
  return {
    id: key.toBase58(),
    machineId,
    count: raw.count,
    paid: raw.paid.toNumber(),
    status: revealed ? "revealed" : "pending",
    pulls: revealed
      ? raw.results.slice(0, raw.count).map((r) => ({ tier: r.tier, value: r.value.toNumber(), stockIdx: r.stockIdx }))
      : [],
    lockedAmount: raw.lockedAmount.toNumber(),
    coins: raw.coins.toNumber(),
    ts: 0,
  };
}

function toMachine(raw: RawMachine, curve: RawCurve | null, owner: PublicKey | null, held: number): MachineInfo {
  const official = "official" in raw.kind;
  return {
    id: raw.id.toString(),
    official,
    name: raw.name,
    symbol: raw.symbol,
    theme: raw.theme,
    basket: Array.from(raw.basket),
    creator: official ? "GachaStock" : short(raw.creator),
    mine: !official && !!owner && raw.creator.equals(owner),
    totalPulls: raw.totalPulls.toNumber(),
    volume: raw.totalVolume.toNumber(),
    jackpots: raw.jackpotsWon,
    creatorAccrued: raw.creatorAccrued.toNumber(),
    coin: curve
      ? {
          mint: raw.coinMint.toBase58(),
          sold: curve.sold.toNumber(),
          marketUsdc: raw.marketUsdc.toNumber(),
          graduated: curve.graduated,
          poolCoins: curve.poolCoins.toNumber(),
          rebatedCoins: curve.rebatedCoins.toNumber(),
          rebatedUsdc: curve.rebatedUsdc.toNumber(),
          held,
        }
      : undefined,
  };
}

// Program errors the UI has its own wording for
const PROGRAM_ERRORS: Record<string, Key> = {
  MarketClosed: "err.marketClosed",
  CreatorCap: "err.creatorCap",
  EarlyCap: "err.earlyCap",
  TooSmall: "err.tooSmall",
  BadMachine: "err.badMachine",
};

/** Runs a transaction and turns known program errors into translated ones. */
async function send<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const code = (e as { error?: { errorCode?: { code?: string } } }).error?.errorCode?.code;
    const key = code && PROGRAM_ERRORS[code];
    if (key) throw new GachaError(key, { amount: MARKET.earlyMaxUsdc / 1_000_000 });
    throw e;
  }
}

type JupIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
const fromJup = (ix: JupIx) =>
  new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, "base64"),
  });

const EMPTY: GachaState = {
  mode: "chain",
  ready: false,
  connected: false,
  usdc: 0,
  dryStreak: 0,
  totalSpent: 0,
  totalWon: 0,
  pool: { prizePool: 0, totalPulls: 0, jackpots: 0 },
  machines: [],
  packs: [],
  recent: [],
  holdings: {},
};

function ChainGacha({ children }: { children: React.ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [state, setState] = useState<GachaState>(EMPTY);
  const [recent, setRecent] = useState<Opening[]>([]);
  const tokenProgram = useRef<PublicKey | null>(null);
  // Latest machines, for quoting trades without another round trip
  const machinesRef = useRef<MachineInfo[]>([]);

  const program = useMemo(() => {
    // Without a wallet this is a read-only provider
    const provider = new AnchorProvider(connection, wallet as never, { commitment: "confirmed" });
    return new Program<KaiguGacha>({ ...idl, address: CHAIN.programId } as KaiguGacha, provider);
  }, [connection, wallet]);

  const usdcMint = useMemo(() => new PublicKey(CHAIN.usdcMint), []);
  const owner = wallet.publicKey;

  const usdcProgram = useCallback(async () => {
    if (!tokenProgram.current) {
      const info = await connection.getAccountInfo(usdcMint);
      if (!info) throw new GachaError("err.mint");
      tokenProgram.current = info.owner;
    }
    return tokenProgram.current;
  }, [connection, usdcMint]);

  // A wallet's packs can only be discovered with getProgramAccounts, which the public RPC
  // throttles hard. So scan once per wallet (and rarely after that), remember the pack
  // addresses, and read them with the same batched call as everything else.
  const known = useRef<{ owner: string; scanned: boolean; age: number; packs: Map<string, PublicKey> } | null>(null);

  const refresh = useCallback(async () => {
    const decode = <T,>(name: string, info: { data: Buffer } | null | undefined) =>
      info ? (program.coder.accounts.decode(name, info.data) as T) : null;
    const tp = owner ? await usdcProgram() : null;
    const usdcAta = owner && tp ? getAssociatedTokenAddressSync(usdcMint, owner, false, tp) : null;

    // One call for the registry counter, the shared vault and the wallet's own accounts
    const base = await connection.getMultipleAccountsInfo([
      pda(Buffer.from("registry")),
      vaultAccounts().vault,
      ...(owner && usdcAta ? [pda(Buffer.from("player"), owner.toBuffer()), usdcAta] : []),
    ]);
    const registry = decode<Awaited<ReturnType<Accounts["registry"]["fetch"]>>>("registry", base[0]);
    const vault = decode<RawVault>("vault", base[1]);
    const player = decode<Awaited<ReturnType<Accounts["player"]["fetch"]>>>("player", base[2]);

    let mine = known.current;
    if (owner) {
      if (!mine || mine.owner !== owner.toBase58()) {
        mine = known.current = { owner: owner.toBase58(), scanned: false, age: 0, packs: new Map() };
      }
      if (!mine.scanned || ++mine.age >= PACK_SCAN_EVERY) {
        try {
          // The size filter skips accounts left over from earlier program versions
          const packs = await program.account.pack.all([
            { dataSize: program.account.pack.size },
            { memcmp: { offset: 8, bytes: owner.toBase58() } },
          ]);
          for (const p of packs) mine.packs.set(p.publicKey.toBase58(), p.publicKey);
          mine.scanned = true;
          mine.age = 0;
        } catch (e) {
          console.warn("pack scan failed, will retry", e);
        }
      }
    }
    const packKeys = owner && mine ? [...mine.packs.values()].slice(0, MAX_PACKS) : [];

    // One more call for every machine, its curve, the wallet's coin balance and its packs
    const total = registry?.machineCount.toNumber() ?? 0;
    const keys = Array.from({ length: Math.min(total, MAX_MACHINES) }, (_, i) => machineAccounts(String(i)));
    const batch = [
      ...keys.map((k) => k.machine),
      ...keys.map((k) => k.curve),
      ...(owner ? keys.map((k) => getAssociatedTokenAddressSync(k.coinMint, owner)) : []),
      ...packKeys,
    ];
    const infos = batch.length ? await connection.getMultipleAccountsInfo(batch) : [];
    const n = keys.length;
    const idByKey = new Map<string, string>();
    const machines = keys.flatMap((k, i) => {
      const raw = infos[i]?.data.length === MACHINE_ACCOUNT_SIZE ? decode<RawMachine>("machine", infos[i]) : null;
      if (!raw) return [];
      idByKey.set(k.machine.toBase58(), raw.id.toString());
      const coin = owner ? infos[2 * n + i] : null;
      return [toMachine(raw, decode<RawCurve>("curve", infos[n + i]), owner, coin ? Number(coin.data.readBigUInt64LE(64)) : 0)];
    });
    machinesRef.current = machines;

    const next: GachaState = { ...EMPTY, ready: true, connected: !!owner, machines };
    if (vault) next.pool = { prizePool: vault.prizePool.toNumber(), totalPulls: vault.totalPulls.toNumber(), jackpots: vault.jackpotsWon };
    if (owner && mine) {
      const packInfos = infos.slice(infos.length - packKeys.length);
      next.packs = packKeys.flatMap((key, i) => {
        // A pack account that no longer exists has been claimed or refunded
        const raw = decode<RawPack>("pack", packInfos[i]);
        if (!raw) mine.packs.delete(key.toBase58());
        return raw ? [toPack(key, raw, idByKey.get(raw.machine.toBase58()) ?? "")] : [];
      });
      next.usdc = base[3] ? Number(base[3].data.readBigUInt64LE(64)) : 0;
      next.dryStreak = player?.dryStreak ?? 0;
      next.totalSpent = player?.totalSpent.toNumber() ?? 0;
      next.totalWon = player?.totalWon.toNumber() ?? 0;
    }
    setState(next);
  }, [connection, owner, program, usdcMint, usdcProgram]);

  // Recent openings, read from the program's latest transactions. Best effort only.
  const refreshRecent = useCallback(async () => {
    try {
      const sigs = await connection.getSignaturesForAddress(programId(), { limit: RECENT_TX_LIMIT });
      const parser = new EventParser(programId(), program.coder);
      const out: Opening[] = [];
      for (const s of sigs) {
        if (s.err) continue;
        await new Promise((r) => setTimeout(r, 250));
        const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        const logs = tx?.meta?.logMessages;
        if (!logs) continue;
        for (const ev of parser.parseLogs(logs)) {
          if (ev.name !== "packOpened") continue;
          const d = ev.data as { owner: PublicKey; machine: PublicKey; count: number; results: { tier: number; value: BN; stockIdx: number }[] };
          const source = machinesRef.current.find((m) => machineAccounts(m.id).machine.equals(d.machine))?.symbol ?? "";
          d.results.slice(0, d.count).forEach((r, i) =>
            out.push({
              id: `${s.signature}-${i}`,
              who: short(d.owner),
              source,
              tier: r.tier,
              value: r.value.toNumber(),
              stockIdx: r.stockIdx,
              ts: (s.blockTime ?? 0) * 1_000,
            }),
          );
        }
      }
      setRecent(out.slice(0, 30));
    } catch (e) {
      console.warn("recent openings unavailable", e);
    }
  }, [connection, program]);

  // After a transaction has landed, a rate-limited re-read must not turn into a failed action
  const settle = useCallback(() => refresh().catch((e) => console.warn("refresh failed", e)), [refresh]);

  useEffect(() => {
    const tick = () => refresh().catch(console.error);
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  useEffect(() => {
    const t = setTimeout(() => refreshRecent(), 2_000);
    return () => clearTimeout(t);
  }, [refreshRecent]);

  const need = useCallback(() => {
    if (!owner) throw new GachaError("err.connect");
    return owner;
  }, [owner]);

  const buy = useCallback(
    async (machineId: string, count: number): Promise<Pack> => {
      const user = need();
      const a = machineAccounts(machineId);
      const machine = await program.account.machine.fetch(a.machine);
      const nonce = new BN(crypto.getRandomValues(new Uint8Array(8)));
      const tp = await usdcProgram();
      const packKey = pda(Buffer.from("pack"), user.toBuffer(), u64le(nonce));

      await send(() =>
        program.methods
          .buyPacks(nonce, count, Array.from(crypto.getRandomValues(new Uint8Array(32))))
          .accountsPartial({
            payer: user,
            user,
            ...vaultAccounts(),
            machine: a.machine,
            // The callback buys the machine coin for the player, so launchpad machines bring their curve
            curve: "official" in machine.kind ? null : a.curve,
            season: pda(Buffer.from("season"), u16le(machine.season)),
            pack: packKey,
            userUsdc: getAssociatedTokenAddressSync(usdcMint, user, false, tp),
            usdcMint,
            tokenProgram: tp,
            oracleQueue: ORACLE_QUEUE,
          })
          .rpc(),
      );
      known.current?.packs.set(packKey.toBase58(), packKey);

      // Wait for the VRF callback to flip the pack to Revealed
      const t0 = Date.now();
      while (Date.now() - t0 < REVEAL_TIMEOUT_MS) {
        const raw = await program.account.pack.fetchNullable(packKey);
        if (raw && "revealed" in raw.status) {
          const pack = toPack(packKey, raw, machineId);
          settle();
          // Show the user's own pull right away instead of re-reading transactions from the RPC
          const now = Date.now();
          setRecent((r) =>
            [
              ...pack.pulls.map((p, i) => ({ id: `${pack.id}-${i}`, who: "you", source: machine.symbol, tier: p.tier, value: p.value, stockIdx: p.stockIdx, ts: now })),
              ...r,
            ].slice(0, 30),
          );
          return pack;
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }
      settle();
      throw new GachaError("err.timeout", { min: Math.round((SEASON.timeoutSlots * 0.4) / 60) });
    },
    [need, program, settle, usdcMint, usdcProgram],
  );

  const packAccounts = useCallback(
    async (packKey: PublicKey) => {
      const user = need();
      const raw = await program.account.pack.fetch(packKey);
      const tp = await usdcProgram();
      // Coins the pulls bought are minted with the claim, into the owner's own token account
      const coinMint = raw.coins.isZero() ? null : pda(Buffer.from("coin"), raw.machine.toBuffer());
      const userCoin = coinMint && getAssociatedTokenAddressSync(coinMint, user);
      return {
        raw,
        pre: coinMint && userCoin ? [createAssociatedTokenAccountIdempotentInstruction(user, userCoin, user, coinMint)] : [],
        accounts: {
          owner: user,
          season: pda(Buffer.from("season"), u16le(raw.season)),
          ...vaultAccounts(),
          machine: raw.machine,
          pack: packKey,
          rentPayer: raw.rentPayer,
          userUsdc: getAssociatedTokenAddressSync(usdcMint, user, false, tp),
          usdcMint,
          tokenProgram: tp,
          coinMint,
          userCoin,
          coinTokenProgram: TOKEN_PROGRAM_ID,
        },
      };
    },
    [need, program, usdcMint, usdcProgram],
  );

  const claim = useCallback(
    async (packId: string, as: ClaimAs) => {
      const user = need();
      const { raw, pre, accounts } = await packAccounts(new PublicKey(packId));

      if (as === "usdc") {
        await send(() => program.methods.claim().accountsPartial(accounts).preInstructions(pre).rpc());
        await settle();
        return;
      }

      // Claim as stock: claim + Jupiter swaps. The first stock swaps atomically with the claim; each other stock gets its own transaction.
      if (CHAIN.cluster !== "mainnet-beta") throw new GachaError("err.devnetStock");
      const claimIx = await program.methods.claim().accountsPartial(accounts).instruction();
      const perStock = new Map<number, number>();
      for (const r of raw.results.slice(0, raw.count)) {
        const v = r.value.toNumber();
        perStock.set(r.stockIdx, (perStock.get(r.stockIdx) ?? 0) + v - bps(v, SEASON.settleFeeBps));
      }
      const { blockhash } = await connection.getLatestBlockhash();
      const txs: VersionedTransaction[] = [];
      let first = true;
      for (const [idx, amount] of perStock) {
        const mint = STOCKS[idx].mint;
        if (!mint) throw new GachaError("err.mintMissing", { ticker: STOCKS[idx].ticker });
        const res = await fetch("/api/jupiter", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inputMint: CHAIN.usdcMint, outputMint: mint, amount, userPublicKey: user.toBase58() }),
        });
        if (!res.ok) throw new GachaError("err.route");
        const swap = await res.json();
        const luts = (
          await Promise.all(
            (swap.addressLookupTableAddresses as string[]).map((a) => connection.getAddressLookupTable(new PublicKey(a))),
          )
        )
          .map((r) => r.value)
          .filter((x): x is AddressLookupTableAccount => !!x);
        const ixs = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
          ...(first ? [...pre, claimIx] : []),
          ...(swap.setupInstructions as JupIx[]).map(fromJup),
          fromJup(swap.swapInstruction),
          ...(swap.cleanupInstruction ? [fromJup(swap.cleanupInstruction)] : []),
        ];
        first = false;
        txs.push(
          new VersionedTransaction(
            new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts),
          ),
        );
      }
      if (!wallet.signAllTransactions) throw new GachaError("err.signAll");
      // Simulate the first transaction (the one with the claim); send nothing if it fails
      const sim = await connection.simulateTransaction(txs[0], { sigVerify: false });
      if (sim.value.err) throw new GachaError("err.simulate");
      const signed = await wallet.signAllTransactions(txs);
      for (const tx of signed) {
        const sig = await connection.sendTransaction(tx);
        await connection.confirmTransaction(sig, "confirmed");
      }
      await settle();
    },
    [connection, need, packAccounts, program, settle, wallet],
  );

  const refund = useCallback(
    async (packId: string) => {
      const { accounts } = await packAccounts(new PublicKey(packId));
      await send(() => program.methods.refundTimeout().accountsPartial(accounts).rpc());
      await settle();
    },
    [packAccounts, program, settle],
  );

  const launchMachine = useCallback(
    async (n: NewMachine) => {
      const creator = need();
      const tp = await usdcProgram();
      const [config, registry] = await Promise.all([
        program.account.config.fetch(pda(Buffer.from("config"))),
        program.account.registry.fetchNullable(pda(Buffer.from("registry"))),
      ]);
      const id = (registry?.machineCount ?? new BN(0)).toString();
      await send(() =>
        program.methods
          .launchMachine({ name: n.name, symbol: n.symbol, theme: n.theme, basket: Buffer.from(n.basket) })
          .accountsPartial({
            creator,
            season: pda(Buffer.from("season"), u16le(config.activeSeason)),
            ...vaultAccounts(),
            ...machineAccounts(id),
            creatorUsdc: getAssociatedTokenAddressSync(usdcMint, creator, false, tp),
            usdcMint,
            tokenProgram: tp,
            coinTokenProgram: TOKEN_PROGRAM_ID,
          })
          // Creating the machine, its coin mint and its curve in one go needs more than the default budget
          .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
          .rpc(),
      );
      await settle();
      return id;
    },
    [need, program, settle, usdcMint, usdcProgram],
  );

  const tradeAccounts = useCallback(
    async (machineId: string) => {
      const user = need();
      const a = machineAccounts(machineId);
      const tp = await usdcProgram();
      return {
        user,
        ...vaultAccounts(),
        ...a,
        userCoin: getAssociatedTokenAddressSync(a.coinMint, user),
        userUsdc: getAssociatedTokenAddressSync(usdcMint, user, false, tp),
        usdcMint,
        tokenProgram: tp,
        coinTokenProgram: TOKEN_PROGRAM_ID,
      };
    },
    [need, usdcMint, usdcProgram],
  );

  /** Minimum acceptable output for a trade, from the last state we read. */
  const minOut = (quote: number) => new BN(Math.floor((quote * (10_000 - SLIPPAGE_BPS)) / 10_000));
  const market = (machineId: string) => {
    const m = machinesRef.current.find((x) => x.id === machineId);
    if (!m?.coin) throw new GachaError("err.marketClosed");
    return m.coin;
  };

  const coinBuy = useCallback(
    async (machineId: string, usdc: number) => {
      const accounts = await tradeAccounts(machineId);
      const quote = quoteBuy(market(machineId), usdc).coins;
      await send(() => program.methods.coinBuy(new BN(usdc), minOut(quote)).accountsPartial(accounts).rpc());
      await settle();
    },
    [program, settle, tradeAccounts],
  );

  const coinSell = useCallback(
    async (machineId: string, coins: number) => {
      const accounts = await tradeAccounts(machineId);
      const quote = quoteSell(market(machineId), coins);
      await send(() => program.methods.coinSell(new BN(coins), minOut(quote)).accountsPartial(accounts).rpc());
      await settle();
    },
    [program, settle, tradeAccounts],
  );

  const withdrawFees = useCallback(
    async (machineId: string) => {
      const payer = need();
      const a = machineAccounts(machineId);
      const tp = await usdcProgram();
      const machine = await program.account.machine.fetch(a.machine);
      const creatorUsdc = getAssociatedTokenAddressSync(usdcMint, machine.creator, true, tp);
      await send(() =>
        program.methods
          .withdrawCreatorFees()
          .accountsPartial({ payer, ...vaultAccounts(), machine: a.machine, creatorUsdc, usdcMint, tokenProgram: tp })
          .preInstructions([createAssociatedTokenAccountIdempotentInstruction(payer, creatorUsdc, machine.creator, usdcMint, tp)])
          .rpc(),
      );
      await settle();
    },
    [need, program, settle, usdcMint, usdcProgram],
  );

  // Devnet only: mint test USDC to the connected wallet
  const faucet = useCallback(async () => {
    const res = await fetch("/api/faucet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: need().toBase58() }),
    });
    if (!res.ok) throw new GachaError("err.faucet");
    await settle();
  }, [need, settle]);

  const api = useMemo<GachaApi>(
    () => ({
      ...state,
      recent,
      buy,
      claim,
      refund,
      launchMachine,
      coinBuy,
      coinSell,
      withdrawFees,
      connect: () => setVisible(true),
      ...(CHAIN.cluster === "devnet" ? { faucet } : {}),
    }),
    [state, recent, buy, claim, refund, launchMachine, coinBuy, coinSell, withdrawFees, faucet, setVisible],
  );
  return <GachaContext.Provider value={api}>{children}</GachaContext.Provider>;
}

export default function ChainProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [], []); // Wallet Standard wallets are discovered automatically
  return (
    <ConnectionProvider endpoint={CHAIN.rpcUrl}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <ChainGacha>{children}</ChainGacha>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
