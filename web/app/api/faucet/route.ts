// Devnet-only test USDC faucet. The mint authority key lives in FAUCET_SECRET_KEY on the server.

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

const AMOUNT = 500 * 1_000_000;
const COOLDOWN_MS = 60_000;
const lastDrip = new Map<string, number>();

export async function POST(req: Request) {
  const secret = process.env.FAUCET_SECRET_KEY;
  const mintAddr = process.env.NEXT_PUBLIC_USDC_MINT;
  if (process.env.NEXT_PUBLIC_CLUSTER !== "devnet" || !secret || !mintAddr)
    return Response.json({ error: "faucet disabled" }, { status: 404 });

  let owner: PublicKey;
  try {
    owner = new PublicKey((await req.json()).owner);
  } catch {
    return Response.json({ error: "bad owner" }, { status: 400 });
  }
  const key = owner.toBase58();
  const now = Date.now();
  if (now - (lastDrip.get(key) ?? 0) < COOLDOWN_MS) return Response.json({ error: "slow down" }, { status: 429 });
  lastDrip.set(key, now);

  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const mint = new PublicKey(mintAddr);
  const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, owner, mint),
    createMintToInstruction(mint, ata, authority.publicKey, AMOUNT),
  );
  try {
    const signature = await connection.sendTransaction(tx, [authority]);
    await connection.confirmTransaction(signature, "confirmed");
    return Response.json({ signature });
  } catch (e) {
    lastDrip.delete(key);
    console.error(e);
    return Response.json({ error: "mint failed" }, { status: 500 });
  }
}
