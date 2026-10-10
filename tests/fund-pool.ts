// Adds test USDC to the shared prize pool on devnet, so every tier is payable for a demo.
// The faucet key mints the amount to the e2e wallet, which then calls fund_pool.
// Usage (from tests/): npx tsx fund-pool.ts [usdc]

import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import idl from "../target/idl/kaigu_gacha.json" with { type: "json" };
import type { KaiguGacha } from "../target/types/kaigu_gacha";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const key = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${ROOT}/.keys/${name}.json`, "utf8"))));
const funder = key("e2e");
const faucet = key("faucet");
const mint = key("usdc-mint").publicKey;
const amount = Math.round(Number(process.argv[2] ?? 5_000) * 1e6);

const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const program = new Program<KaiguGacha>(idl as KaiguGacha, new AnchorProvider(connection, new Wallet(funder), { commitment: "confirmed" }));
const pda = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, program.programId)[0];
const vault = pda(Buffer.from("prize_vault"));
const ata = getAssociatedTokenAddressSync(mint, funder.publicKey);

const mintTx = new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, ata, funder.publicKey, mint),
  createMintToInstruction(mint, ata, faucet.publicKey, amount),
);
await connection.sendTransaction(mintTx, [faucet]).then((s) => connection.confirmTransaction(s, "confirmed"));

const before = (await program.account.vault.fetch(vault)).prizePool.toNumber() / 1e6;
const sig = await program.methods
  .fundPool(new BN(amount))
  .accountsPartial({ funder: funder.publicKey, vault, vaultToken: pda(Buffer.from("prize_vault_token")), funderUsdc: ata, usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID })
  .rpc();
const after = (await program.account.vault.fetch(vault)).prizePool.toNumber() / 1e6;
console.log("fund_pool:", sig);
console.log(`prize pool: ${before} → ${after} USDC`);
