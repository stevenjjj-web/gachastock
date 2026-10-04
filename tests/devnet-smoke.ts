// Devnet smoke test against the deployed program and the live MagicBlock VRF oracle:
// mint test USDC → buy a pack on a machine → wait for the VRF callback → claim USDC and,
// on a launchpad machine, the machine coins the pulls bought.
// Usage (from tests/): npx tsx devnet-smoke.ts [count] [machineId]

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
const user = key("e2e");
const faucet = key("faucet");
const mint = key("usdc-mint").publicKey;
const QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
const count = Number(process.argv[2] ?? 1);
const machineId = Number(process.argv[3] ?? 0);

const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const program = new Program<KaiguGacha>(idl as KaiguGacha, new AnchorProvider(connection, new Wallet(user), { commitment: "confirmed" }));
const pda = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, program.programId)[0];
const ata = getAssociatedTokenAddressSync(mint, user.publicKey);
const bal = async () => Number((await connection.getTokenAccountBalance(ata)).value.amount) / 1e6;

const mintTx = new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, ata, user.publicKey, mint),
  createMintToInstruction(mint, ata, faucet.publicKey, 10 * count * 1e6),
);
await connection.sendTransaction(mintTx, [faucet]).then((s) => connection.confirmTransaction(s, "confirmed"));
console.log("USDC before buy:", await bal());

const machine = pda(Buffer.from("machine"), new BN(machineId).toArrayLike(Buffer, "le", 8));
const m0 = await program.account.machine.fetch(machine);
const official = "official" in m0.kind;
const season = pda(Buffer.from("season"), new BN(m0.season).toArrayLike(Buffer, "le", 2));
const vault = pda(Buffer.from("prize_vault"));
const vaultToken = pda(Buffer.from("prize_vault_token"));
const curve = pda(Buffer.from("curve"), machine.toBuffer());
const coinMint = pda(Buffer.from("coin"), machine.toBuffer());
const userCoin = getAssociatedTokenAddressSync(coinMint, user.publicKey);
const nonce = new BN(Date.now());
const pack = pda(Buffer.from("pack"), user.publicKey.toBuffer(), nonce.toArrayLike(Buffer, "le", 8));
const t0 = Date.now();
const buySig = await program.methods
  .buyPacks(nonce, count, Array.from(crypto.getRandomValues(new Uint8Array(32))))
  .accountsPartial({
    payer: user.publicKey,
    user: user.publicKey,
    vault,
    machine,
    curve: official ? null : curve,
    season,
    pack,
    userUsdc: ata,
    vaultToken,
    usdcMint: mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    oracleQueue: QUEUE,
  })
  .rpc();
console.log(`buy_packs on ${m0.name}:`, buySig);

let coins = new BN(0);
for (;;) {
  const p = await program.account.pack.fetchNullable(pack);
  if (p && "revealed" in p.status) {
    console.log(`revealed after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    for (const r of p.results.slice(0, p.count)) console.log(`  tier ${r.tier}  value ${r.value.toNumber() / 1e6}  stock ${r.stockIdx}`);
    coins = p.coins;
    console.log(`  machine coins bought: ${coins.toNumber() / 1e6}`);
    break;
  }
  if (Date.now() - t0 > 120_000) throw new Error("VRF callback did not arrive within 120s");
  await new Promise((r) => setTimeout(r, 1000));
}

const claimSig = await program.methods
  .claim()
  .accountsPartial({
    owner: user.publicKey,
    season,
    vault,
    machine,
    pack,
    rentPayer: user.publicKey,
    userUsdc: ata,
    vaultToken,
    usdcMint: mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    coinMint: coins.isZero() ? null : coinMint,
    userCoin: coins.isZero() ? null : userCoin,
  })
  .preInstructions(coins.isZero() ? [] : [createAssociatedTokenAccountIdempotentInstruction(user.publicKey, userCoin, user.publicKey, coinMint)])
  .rpc();
console.log("claim:", claimSig);
console.log("USDC after claim:", await bal());
if (!coins.isZero()) console.log("coin balance:", Number((await connection.getTokenAccountBalance(userCoin)).value.amount) / 1e6);
const v = await program.account.vault.fetch(vault);
const n = (x: BN) => x.toNumber() / 1e6;
const owed = n(v.pending) + n(v.prizePool) + n(v.locked) + n(v.protocolFees) + n(v.markets);
console.log("vault:", { prizePool: n(v.prizePool), protocolFees: n(v.protocolFees), markets: n(v.markets), locked: n(v.locked), pending: n(v.pending), pulls: v.totalPulls.toNumber() });
console.log("vault token balance:", Number((await connection.getTokenAccountBalance(vaultToken)).value.amount) / 1e6, "owed:", owed);
