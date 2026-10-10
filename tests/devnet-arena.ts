// Devnet end-to-end run of Leverage Box across Solana and a MagicBlock Ephemeral Rollup:
// create and delegate the arena (first run only) → two players deposit and delegate →
// open boxes in the rollup (MagicBlock VRF) → lock and settle a round at the live oracle
// price → claim → leave the rollup → withdraw on Solana.
// Usage (from tests/): npx tsx devnet-arena.ts [boxesPerPlayer]

import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import idl from "../target/idl/leverage_box.json" with { type: "json" };
import type { LeverageBox } from "../target/types/leverage_box";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const key = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${ROOT}/.keys/${name}.json`, "utf8"))));
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))));
const faucet = key("faucet");
const mint = key("usdc-mint").publicKey;
const players = [key("e2e"), faucet];
const BOXES = Number(process.argv[2] ?? 3);

const FEED_ID = 6; // Pyth Lazer SOL/USD
const USDC = 1_000_000;
const BASE_RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC_URL ?? "https://devnet-as.magicblock.app";
// MagicBlock's public devnet validator in Asia; accounts are delegated to it
const ER_VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
const LEVERAGE = [500, 1_000, 2_500, 5_000, 10_000];

const base = new Connection(BASE_RPC, "confirmed");
const er = new Connection(ER_RPC, { commitment: "confirmed", wsEndpoint: ER_RPC.replace("https", "wss") });
const program = new Program<LeverageBox>(idl as LeverageBox, new AnchorProvider(base, new Wallet(admin), { commitment: "confirmed" }));
const erProgram = new Program<LeverageBox>(idl as LeverageBox, new AnchorProvider(er, new Wallet(admin), { commitment: "confirmed" }));
const pda = (...s: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(s, program.programId)[0];
const arena = pda(Buffer.from("arena"), new BN(FEED_ID).toArrayLike(Buffer, "le", 4));
const vault = pda(Buffer.from("vault"));
const playerOf = (owner: PublicKey) => pda(Buffer.from("player"), owner.toBuffer());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (n: BN | number) => (Number(n) / USDC).toFixed(2);

async function sendBase(ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await base.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const sig = await base.sendRawTransaction(tx.serialize());
  await base.confirmTransaction(sig, "confirmed");
  return sig;
}
/** Sends to the rollup. The fee payer needs no SOL there. */
async function sendEr(ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const t0 = Date.now();
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await er.confirmTransaction(sig, "confirmed");
  const st = await er.getSignatureStatus(sig);
  if (st.value?.err) {
    const logs = (await er.getTransaction(sig, { maxSupportedTransactionVersion: 0 }))?.meta?.logMessages;
    throw new Error(`rollup tx failed: ${JSON.stringify(st.value.err)}\n${logs?.join("\n")}`);
  }
  return { sig, ms: Date.now() - t0 };
}
const owner = async (k: PublicKey, c: Connection) => (await c.getAccountInfo(k))?.owner.toBase58();

// ---- 1. Arena ----
if (!(await base.getAccountInfo(arena))) {
  const sig = await program.methods
    .initArena(FEED_ID, { openSecs: 20, liveSecs: 30, feeBps: 1_000, minStake: new BN(USDC), maxStake: new BN(100 * USDC) })
    .accountsPartial({ admin: admin.publicKey, arena, vault, usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([admin])
    .rpc();
  console.log("init_arena:", sig);
}
if ((await owner(arena, base)) === program.programId.toBase58()) {
  const ix = await program.methods
    .delegateArena(FEED_ID)
    .accountsPartial({ admin: admin.publicKey, arena })
    .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
    .instruction();
  console.log("delegate_arena:", await sendBase([ix], [admin]));
}
console.log("arena", arena.toBase58(), "owner on Solana:", await owner(arena, base));

// ---- 2. Players deposit and delegate ----
const sessions = players.map(() => Keypair.generate());
for (const [i, p] of players.entries()) {
  const player = playerOf(p.publicKey);
  const ata = getAssociatedTokenAddressSync(mint, p.publicKey);
  const o = await owner(player, base);
  if (o && o !== program.programId.toBase58()) {
    // Still in the rollup from an earlier run: bring it back first
    const a = await erProgram.account.player.fetch(player);
    if (!a.pending && a.tickets.every((t) => t.side === 0)) {
      await sendEr([await erProgram.methods.leave().accountsPartial({ signer: p.publicKey, player }).instruction()], [p]);
      for (let k = 0; k < 30 && (await owner(player, base)) !== program.programId.toBase58(); k++) await sleep(1_000);
    }
  }
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(p.publicKey, ata, p.publicKey, mint),
    await program.methods
      .enter(new BN(100 * USDC), sessions[i].publicKey)
      .accountsPartial({ owner: p.publicKey, player, vault, ownerUsdc: ata, usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction(),
    await program.methods
      .delegatePlayer()
      .accountsPartial({ owner: p.publicKey, player })
      .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
      .instruction(),
  ];
  await sendBase([createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, ata, p.publicKey, mint), createMintToInstruction(mint, ata, faucet.publicKey, 100 * USDC)], [faucet]);
  console.log(`player ${i} enter + delegate:`, await sendBase(ixs, [p]));
}
console.log("vault on Solana:", usd(Number((await base.getTokenAccountBalance(vault)).value.amount)), "USDC");

// ---- 3. Open boxes in the rollup, signed by session keys that hold no SOL ----
const openBox = async (i: number) => {
  const player = playerOf(players[i].publicKey);
  const ix = await erProgram.methods
    .openBox(new BN(10 * USDC), Array.from(crypto.getRandomValues(new Uint8Array(32))))
    .accountsPartial({ signer: sessions[i].publicKey, player, arena, oracleQueue: VRF_EPHEMERAL_QUEUE })
    .instruction();
  const { sig, ms } = await sendEr([ix], [sessions[i]]);
  const t0 = Date.now();
  for (;;) {
    const a = await erProgram.account.player.fetch(player, "processed");
    if (!a.pending) {
      const t = a.tickets.filter((x) => x.side !== 0).at(-1);
      console.log(`  player ${i}: box confirmed in ${ms} ms, drawn ${Date.now() - t0} ms later → ${t ? `${LEVERAGE[t.tier]}x ${t.side === 1 ? "LONG" : "SHORT"}` : "refunded"}  ${sig.slice(0, 12)}…`);
      return;
    }
    if (Date.now() - t0 > 30_000) throw new Error("VRF callback did not arrive in the rollup");
    await sleep(150);
  }
};
let a0 = await erProgram.account.arena.fetch(arena);
console.log(`\nround ${a0.round} is ${a0.phase === 0 ? "open" : "live"}; opening ${BOXES} boxes per player`);
if (a0.phase !== 0) {
  // A previous run left a live round: finish it first
  while ((await erProgram.account.arena.fetch(arena)).phase !== 0) {
    await sendEr([await erProgram.methods.tick().accountsPartial({ arena, feed: a0.feed }).instruction()], [sessions[0]]);
    await sleep(2_000);
  }
}
for (let n = 0; n < BOXES; n++) for (let i = 0; i < players.length; i++) await openBox(i);

// ---- 4. Lock and settle ----
const tick = async () => sendEr([await erProgram.methods.tick().accountsPartial({ arena, feed: a0.feed }).instruction()], [sessions[0]]);
const price = async () => Number((await er.getAccountInfo(a0.feed))!.data.readBigInt64LE(73)) / 1e8;
a0 = await erProgram.account.arena.fetch(arena);
const round = a0.round;
const [wl, ws] = [0, 1].map((s) => a0.buckets[s].reduce((sum, b, t) => sum + (Number(b) / USDC) * LEVERAGE[t], 0));
console.log(`\n${a0.tickets} tickets, ${usd(a0.staked)} USDC staked; weight long ${wl} vs short ${ws}`);
for (;;) {
  const a = await erProgram.account.arena.fetch(arena, "processed");
  if (a.round.gt(round)) break;
  const now = Date.now() / 1000;
  const due = a.phase === 0 ? a.lockAt.toNumber() : a.endAt.toNumber();
  if (now >= due) {
    const { ms } = await tick();
    const b = await erProgram.account.arena.fetch(arena, "processed");
    if (b.phase === 1 && a.phase === 0) console.log(`locked at ${(b.startPrice.toNumber() / 1e8).toFixed(4)} (tick confirmed in ${ms} ms)`);
  } else {
    process.stdout.write(`  ${a.phase === 0 ? "locks" : "settles"} in ${(due - now).toFixed(0)}s, SOL ${(await price()).toFixed(4)}\r`);
  }
  await sleep(1_000);
}
const after = await erProgram.account.arena.fetch(arena);
const res = after.history[round.toNumber() % after.history.length];
console.log(`\nround ${round} settled: ${(res.startPrice.toNumber() / 1e8).toFixed(4)} → ${(res.endPrice.toNumber() / 1e8).toFixed(4)} (${(res.rPpm.toNumber() / 1e4).toFixed(4)}%)`);
console.log(`  losers owed ${usd(res.owed)}, winners claimed ${usd(res.claimed)}, changed hands ${usd(res.moved)} USDC`);

// ---- 5. Claim, leave, withdraw ----
let total = 0;
for (const [i, p] of players.entries()) {
  const player = playerOf(p.publicKey);
  await sendEr([await erProgram.methods.claim().accountsPartial({ player, arena }).instruction()], [sessions[i]]);
  const a = await erProgram.account.player.fetch(player);
  total += a.balance.toNumber();
  console.log(`player ${i}: balance ${usd(a.balance)} USDC after ${BOXES} boxes`);
  await sendEr([await erProgram.methods.leave().accountsPartial({ signer: sessions[i].publicKey, player }).instruction()], [sessions[i]]);
}
const fees = (await erProgram.account.arena.fetch(arena)).fees.toNumber();
console.log(`balances ${usd(total)} + fees so far ${usd(fees)} USDC`);
for (const [i, p] of players.entries()) {
  const player = playerOf(p.publicKey);
  const t0 = Date.now();
  while ((await owner(player, base)) !== program.programId.toBase58()) {
    if (Date.now() - t0 > 60_000) throw new Error("the account did not come back to Solana");
    await sleep(1_000);
  }
  const ata = getAssociatedTokenAddressSync(mint, p.publicKey);
  const before = Number((await base.getTokenAccountBalance(ata)).value.amount);
  const sig = await program.methods
    .withdraw()
    .accountsPartial({ owner: p.publicKey, player, vault, ownerUsdc: ata, usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([p])
    .rpc();
  const got = Number((await base.getTokenAccountBalance(ata)).value.amount) - before;
  console.log(`player ${i}: back on Solana after ${((Date.now() - t0) / 1000).toFixed(1)}s, withdrew ${usd(got)} USDC  ${sig.slice(0, 12)}…`);
}
console.log("vault on Solana:", usd(Number((await base.getTokenAccountBalance(vault)).value.amount)), "USDC (fees and rounding dust)");
