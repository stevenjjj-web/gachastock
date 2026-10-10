// A second player for Leverage Box on devnet, so a round has someone on the other side.
// Deposits if needed, then opens a few boxes in every round and keeps the rounds moving.
// Usage (from tests/): npx tsx arena-bot.ts [minutes] [asset: SOL|BTC|ETH] [boxesPerRound]

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
const bot = key("faucet");
const mint = key("usdc-mint").publicKey;
const MINUTES = Number(process.argv[2] ?? 10);
const FEED_ID = { SOL: 6, BTC: 1, ETH: 2 }[process.argv[3] ?? "SOL"] ?? 6;
const PER_ROUND = Number(process.argv[4] ?? 4);
const USDC = 1_000_000;
const LEVERAGE = [500, 1_000, 2_500, 5_000, 10_000];
const ER_VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");

const base = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const erUrl = process.env.ER_RPC_URL ?? "https://devnet-as.magicblock.app";
const er = new Connection(erUrl, { commitment: "confirmed", wsEndpoint: erUrl.replace(/^http/, "ws") });
const program = new Program<LeverageBox>(idl as LeverageBox, new AnchorProvider(base, new Wallet(bot), { commitment: "confirmed" }));
const erProgram = new Program<LeverageBox>(idl as LeverageBox, new AnchorProvider(er, new Wallet(bot), { commitment: "confirmed" }));
const pda = (...s: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(s, program.programId)[0];
const arena = pda(Buffer.from("arena"), new BN(FEED_ID).toArrayLike(Buffer, "le", 4));
const player = pda(Buffer.from("player"), bot.publicKey.toBuffer());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendEr(ixs: TransactionInstruction[]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = bot.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(bot);
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await er.confirmTransaction(sig, "confirmed");
  return !(await er.getSignatureStatus(sig)).value?.err;
}

// Make sure the bot is in the rollup with something to play with
const info = await base.getAccountInfo(player);
const inRollup = !!info && !info.owner.equals(program.programId);
const balance = inRollup ? (await erProgram.account.player.fetch(player)).balance.toNumber() : 0;
if (!inRollup) {
  const ata = getAssociatedTokenAddressSync(mint, bot.publicKey);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(bot.publicKey, ata, bot.publicKey, mint),
    createMintToInstruction(mint, ata, bot.publicKey, 2_000 * USDC),
    await program.methods
      .enter(new BN(2_000 * USDC), bot.publicKey)
      .accountsPartial({ owner: bot.publicKey, player, vault: pda(Buffer.from("vault")), ownerUsdc: ata, usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction(),
    await program.methods
      .delegatePlayer()
      .accountsPartial({ owner: bot.publicKey, player })
      .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
      .instruction(),
  );
  tx.feePayer = bot.publicKey;
  tx.recentBlockhash = (await base.getLatestBlockhash()).blockhash;
  tx.sign(bot);
  await base.confirmTransaction(await base.sendRawTransaction(tx.serialize()), "confirmed");
  console.log("bot deposited 2,000 test USDC and entered the rollup");
} else {
  console.log(`bot is in the rollup with ${(balance / USDC).toFixed(2)} USDC`);
}

const feed = (await erProgram.account.arena.fetch(arena)).feed;
const until = Date.now() + MINUTES * 60_000;
let lastRound = 0;
let opened = 0;
while (Date.now() < until) {
  try {
    const a = await erProgram.account.arena.fetch(arena, "processed");
    const me = await erProgram.account.player.fetch(player, "processed");
    const round = a.round.toNumber();
    if (round !== lastRound) {
      const res = a.history[(round - 1) % a.history.length];
      if (lastRound && res.round.toNumber() === round - 1)
        console.log(`round ${round - 1}: ${(res.rPpm.toNumber() / 1e4).toFixed(4)}%, ${(res.moved.toNumber() / USDC).toFixed(2)} USDC changed hands; bot balance ${(me.balance.toNumber() / USDC).toFixed(2)}`);
      lastRound = round;
      opened = 0;
    }
    const now = Date.now() / 1_000;
    const mine = me.tickets.filter((t) => t.side !== 0);
    if (mine.some((t) => t.round.toNumber() < round)) {
      await sendEr([await erProgram.methods.claim().accountsPartial({ player, arena }).instruction()]);
    } else if (a.phase === 0 && opened < PER_ROUND && !me.pending && mine.length < 8 && (a.lockAt.isZero() || now < a.lockAt.toNumber() - 1)) {
      const stake = [5, 10, 10, 25][Math.floor(Math.random() * 4)] * USDC;
      const ok = await sendEr([
        await erProgram.methods
          .openBox(new BN(stake), Array.from(crypto.getRandomValues(new Uint8Array(32))))
          .accountsPartial({ signer: bot.publicKey, player, arena, oracleQueue: VRF_EPHEMERAL_QUEUE })
          .instruction(),
      ]);
      if (ok) opened++;
      await sleep(300);
      const t = (await erProgram.account.player.fetch(player, "processed")).tickets.filter((x) => x.side !== 0).at(-1);
      if (ok && t) console.log(`  round ${round}: bot drew ${LEVERAGE[t.tier]}x ${t.side === 1 ? "LONG" : "SHORT"} for ${stake / USDC} USDC`);
    } else if ((a.phase === 0 && a.tickets > 0 && !a.lockAt.isZero() && now >= a.lockAt.toNumber()) || (a.phase === 1 && now >= a.endAt.toNumber())) {
      await sendEr([await erProgram.methods.tick().accountsPartial({ arena, feed }).instruction()]);
    }
  } catch (e) {
    console.warn("bot step failed:", (e as Error).message.slice(0, 160));
  }
  await sleep(700);
}
console.log("bot done");
