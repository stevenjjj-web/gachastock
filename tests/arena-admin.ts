// Creates, delegates and configures the Leverage Box arenas on devnet. Safe to re-run.
// Usage (from tests/): npx tsx arena-admin.ts [openSecs] [liveSecs]

import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import idl from "../target/idl/leverage_box.json" with { type: "json" };
import type { LeverageBox } from "../target/types/leverage_box";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))));
const mint = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${ROOT}/.keys/usdc-mint.json`, "utf8")))).publicKey;
// Pyth Lazer feed ids served by MagicBlock's oracle in the rollup
const FEEDS: [string, number][] = [["SOL", 6], ["BTC", 1], ["ETH", 2]];
const USDC = 1_000_000;
const args = {
  openSecs: Number(process.argv[2] ?? 15),
  liveSecs: Number(process.argv[3] ?? 30),
  feeBps: 1_000,
  minStake: new BN(USDC),
  maxStake: new BN(100 * USDC),
};
const ER_VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const base = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const er = new Connection(process.env.ER_RPC_URL ?? "https://devnet-as.magicblock.app", "confirmed");
const program = new Program<LeverageBox>(idl as LeverageBox, new AnchorProvider(base, new Wallet(admin), { commitment: "confirmed" }));
const erProgram = new Program<LeverageBox>(idl as LeverageBox, new AnchorProvider(er, new Wallet(admin), { commitment: "confirmed" }));
const pda = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, program.programId)[0];

for (const [name, feedId] of FEEDS) {
  const arena = pda(Buffer.from("arena"), new BN(feedId).toArrayLike(Buffer, "le", 4));
  if (!(await base.getAccountInfo(arena))) {
    const sig = await program.methods
      .initArena(feedId, args)
      .accountsPartial({ admin: admin.publicKey, arena, vault: pda(Buffer.from("vault")), usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    console.log(name, "init_arena", sig);
  }
  if ((await base.getAccountInfo(arena))!.owner.equals(program.programId)) {
    const sig = await program.methods
      .delegateArena(feedId)
      .accountsPartial({ admin: admin.publicKey, arena })
      .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
      .rpc();
    console.log(name, "delegate_arena", sig);
  }
  // The arena lives in the rollup now, so its settings are changed there
  const tx = new Transaction().add(await erProgram.methods.configure(args).accountsPartial({ admin: admin.publicKey, arena }).instruction());
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(admin);
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await er.confirmTransaction(sig, "confirmed");
  const a = await erProgram.account.arena.fetch(arena);
  console.log(name, arena.toBase58(), `round ${a.round}, open ${a.openSecs}s, live ${a.liveSecs}s, fee ${a.feeBps / 100}% of winnings, feed ${a.feed.toBase58()}`);
}
