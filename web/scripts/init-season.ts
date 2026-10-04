// Run after deploying: initialize (first time only), publish a season, open the shared vault
// and create the official machines that do not exist yet.
// Usage: cd web && USDC_MINT=<mint> npx tsx scripts/init-season.ts
// The wallet must be the program upgrade authority (ANCHOR_WALLET, default ~/.config/solana/id.json).
// Set NEW_SEASON=1 to publish a new season even when one already exists.

import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { MACHINE_ACCOUNT_SIZE, OFFICIAL_MACHINES, SEASON, STOCKS, TIERS } from "../lib/config";
import idl from "../lib/idl/kaigu_gacha.json";
import type { KaiguGacha } from "../lib/idl/kaigu_gacha";

process.env.ANCHOR_PROVIDER_URL ??= "https://api.devnet.solana.com";
process.env.ANCHOR_WALLET ??= `${process.env.HOME}/.config/solana/id.json`;

const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

async function main() {
  const provider = AnchorProvider.env();
  const program = new Program<KaiguGacha>(idl as KaiguGacha, provider);
  const admin = provider.wallet.publicKey;
  const pda = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, program.programId)[0];
  const u16 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 2);
  const u64 = (n: BN | number) => new BN(n).toArrayLike(Buffer, "le", 8);
  const configKey = pda(Buffer.from("config"));

  if (!(await provider.connection.getAccountInfo(configKey))) {
    const sig = await program.methods
      .initialize(new PublicKey(process.env.TREASURY ?? admin))
      .accountsPartial({
        admin,
        usdcMint: new PublicKey(process.env.USDC_MINT!),
        program: program.programId,
        programData: PublicKey.findProgramAddressSync([program.programId.toBuffer()], BPF_UPGRADEABLE)[0],
      })
      .rpc();
    console.log("initialize", sig);
  }

  let config = await program.account.config.fetch(configKey);
  // A season published by an older program version has a different layout; tell them apart by size
  const active = await provider.connection.getAccountInfo(pda(Buffer.from("season"), u16(config.activeSeason)));
  const current = active?.data.length === program.account.season.size;
  if (!current || config.seasonCount === 0 || process.env.NEW_SEASON) {
    const sig = await program.methods
      .createSeason({
        packPrice: new BN(SEASON.packPrice),
        feeBps: SEASON.feeBps,
        poolBps: SEASON.poolBps,
        settleFeeBps: SEASON.settleFeeBps,
        capBps: SEASON.capBps,
        jackpotShareBps: SEASON.jackpotShareBps,
        pity: SEASON.pity,
        timeoutSlots: new BN(SEASON.timeoutSlots),
        jackpotMinPool: new BN(SEASON.jackpotMinPool),
        tiers: TIERS.map((t) => ({ probPpm: t.ppm, bonus: new BN(t.bonus) })),
        // Whitelist order must match the frontend STOCKS array (stock_idx is the index)
        whitelist: STOCKS.map((s) => (s.mint ? new PublicKey(s.mint) : PublicKey.default)),
      })
      .accountsPartial({ admin, season: pda(Buffer.from("season"), u16(config.seasonCount)) })
      .rpc();
    console.log("create_season", config.seasonCount, sig);
    config = await program.account.config.fetch(configKey);
  }

  const vault = pda(Buffer.from("prize_vault"));
  if (!(await provider.connection.getAccountInfo(vault))) {
    const sig = await program.methods
      .initVault()
      .accountsPartial({ admin, vaultToken: pda(Buffer.from("prize_vault_token")), usdcMint: config.usdcMint, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    console.log("init_vault", sig);
  }

  // Official machines are matched by ticker. Machine accounts of another size were created by
  // an earlier program version and are ignored.
  const registry = await program.account.registry.fetchNullable(pda(Buffer.from("registry")));
  let next = registry?.machineCount.toNumber() ?? 0;
  const existing = await provider.connection.getMultipleAccountsInfo(Array.from({ length: next }, (_, i) => pda(Buffer.from("machine"), u64(i))));
  const have = new Set(
    existing
      .filter((info) => info?.data.length === MACHINE_ACCOUNT_SIZE)
      .map((info) => program.coder.accounts.decode("machine", info!.data))
      .filter((m) => "official" in m.kind)
      .map((m) => m.symbol as string),
  );
  for (const m of OFFICIAL_MACHINES.filter((x) => !have.has(x.symbol))) {
    const sig = await program.methods
      .createMachine({ name: m.name, symbol: m.symbol, theme: m.theme, basket: Buffer.from(m.basket) })
      .accountsPartial({ admin, season: pda(Buffer.from("season"), u16(config.activeSeason)), machine: pda(Buffer.from("machine"), u64(next)) })
      .rpc();
    console.log("create_machine", next, m.symbol, sig);
    next += 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
