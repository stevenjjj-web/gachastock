// End-to-end program test in LiteSVM, using the real MagicBlock VRF program and queue
// account dumped from devnet (tests/fixtures). Sigverify is off so the test can act as
// the VRF oracle and sign the callback with the scoped VRF identity PDA.

import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import idl from "../target/idl/kaigu_gacha.json" with { type: "json" };
import type { KaiguGacha } from "../target/types/kaigu_gacha";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROGRAM_ID = new PublicKey(idl.address);
const VRF_ID = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
const QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const USDC = 1_000_000;
const COIN = 1_000_000;
const CURVE_SUPPLY = 800_000_000 * COIN;

const pda = (seeds: (Buffer | Uint8Array)[], program = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, program)[0];
const u16 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 2);
const u64 = (n: BN | number) => new BN(n).toArrayLike(Buffer, "le", 8);

const CONFIG = pda([Buffer.from("config")]);
const REGISTRY = pda([Buffer.from("registry")]);
const SEASON0 = pda([Buffer.from("season"), u16(0)]);
const VAULT = pda([Buffer.from("prize_vault")]);
const VAULT_TOKEN = pda([Buffer.from("prize_vault_token")]);
const PROGRAM_DATA = pda([PROGRAM_ID.toBuffer()], LOADER);
const PROGRAM_IDENTITY = pda([Buffer.from("identity")]);
const SCOPED_VRF_IDENTITY = pda([Buffer.from("identity"), PROGRAM_ID.toBuffer()], VRF_ID);

const machineKeys = (id: number) => {
  const machine = pda([Buffer.from("machine"), u64(id)]);
  return {
    machine,
    curve: pda([Buffer.from("curve"), machine.toBuffer()]),
    coinMint: pda([Buffer.from("coin"), machine.toBuffer()]),
  };
};

// Probability in ppm and the bonus on top of the 7.50 floor, in cents
const TIERS: [number, number][] = [
  [788_750, 0],
  [175_000, 350],
  [22_500, 1_750],
  [13_000, 3_250],
  [500, 9_250],
  [200, 49_250],
  [50, 0],
];

type VaultAcc = { pending: BN; prizePool: BN; locked: BN; protocolFees: BN; markets: BN; totalPulls: BN; totalVolume: BN };
type MachineAcc = { kind: object; marketUsdc: BN; creatorAccrued: BN; totalPulls: BN; totalVolume: BN };
type CurveAcc = { sold: BN; creatorBought: BN; graduated: boolean; poolCoins: BN; rebatedCoins: BN; rebatedUsdc: BN };
type PackAcc = { status: object; lockedAmount: BN; coins: BN; results: { tier: number; value: BN; stockIdx: number }[] };

describe("kaigu-gacha on LiteSVM", () => {
  const svm = new LiteSVM().withSigverify(false);
  const admin = Keypair.generate();
  const treasury = Keypair.generate();
  const user = Keypair.generate();
  const creator = Keypair.generate();
  const mint = Keypair.generate();
  const program = new Program<KaiguGacha>(
    idl as KaiguGacha,
    new AnchorProvider(new Connection("http://127.0.0.1:1"), new Wallet(admin), {}),
  );
  const usdcOf = (owner: PublicKey) => getAssociatedTokenAddressSync(mint.publicKey, owner);
  const userUsdc = usdcOf(user.publicKey);
  const playerOf = (owner: PublicKey) => pda([Buffer.from("player"), owner.toBuffer()]);
  /** Launchpad machines created so far; their markets must add up to the vault's `markets`. */
  const launched: number[] = [];

  const send = (ixs: TransactionInstruction[], signers: Keypair[], extraSigners: PublicKey[] = []) => {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.add(...ixs);
    tx.sign(...signers);
    for (const k of extraSigners) tx.addSignature(k, Buffer.alloc(64, 7));
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  };
  const ok = (res: ReturnType<typeof send>) => {
    if (res instanceof FailedTransactionMetadata) assert.fail(`${res.toString()}\n${res.meta().logs().join("\n")}`);
    return res;
  };
  const fails = (res: ReturnType<typeof send>, needle: string) => {
    assert.ok(res instanceof FailedTransactionMetadata, `expected the transaction to fail with ${needle}`);
    const logs = res.meta().logs().join("\n");
    assert.ok(logs.includes(needle), `expected "${needle}" in logs:\n${logs}`);
  };
  const decode = <T>(name: string, key: PublicKey): T =>
    program.coder.accounts.decode(name, Buffer.from(svm.getAccount(key)!.data)) as T;
  const tokenBalance = (key: PublicKey) => Number(Buffer.from(svm.getAccount(key)!.data).readBigUInt64LE(64));
  const coinSupply = (id: number) => Number(Buffer.from(svm.getAccount(machineKeys(id).coinMint)!.data).readBigUInt64LE(36));
  const vault = () => decode<VaultAcc>("vault", VAULT);
  const machine = (id: number) => decode<MachineAcc>("machine", machineKeys(id).machine);
  const curve = (id: number) => decode<CurveAcc>("curve", machineKeys(id).curve);
  /** The vault's token account must hold exactly what the ledgers say, machine by machine. */
  const assertSolvent = () => {
    const v = vault();
    const owed = [v.pending, v.prizePool, v.locked, v.protocolFees, v.markets].reduce((a, b) => a + b.toNumber(), 0);
    assert.equal(tokenBalance(VAULT_TOKEN), owed, "token balance must equal the ledger");
    const markets = launched.reduce((a, id) => a + machine(id).marketUsdc.toNumber() + machine(id).creatorAccrued.toNumber(), 0);
    assert.equal(v.markets.toNumber(), markets, "the vault's markets total must equal the machines' own ledgers");
  };
  const fund = (owner: Keypair, usdc: number) => {
    svm.airdrop(owner.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    ok(
      send(
        [
          createAssociatedTokenAccountInstruction(admin.publicKey, usdcOf(owner.publicKey), owner.publicKey, mint.publicKey),
          createMintToInstruction(mint.publicKey, usdcOf(owner.publicKey), admin.publicKey, usdc * USDC),
        ],
        [admin],
      ),
    );
  };

  const args = (o: Partial<{ name: string; symbol: string; basket: number[] }> = {}) => ({
    name: o.name ?? "Mag 7 Mania",
    symbol: o.symbol ?? "MAG7",
    theme: 1,
    basket: Buffer.from(o.basket ?? [2, 3, 4]),
  });

  const createMachineIx = (id: number, signer: PublicKey) =>
    program.methods
      .createMachine(args({ name: "Tech Machine", symbol: "TECH" }))
      .accountsStrict({
        admin: signer,
        config: CONFIG,
        season: SEASON0,
        registry: REGISTRY,
        machine: machineKeys(id).machine,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

  const launchIx = (id: number, o: Parameters<typeof args>[0] = {}) => {
    const k = machineKeys(id);
    return program.methods
      .launchMachine(args(o))
      .accountsStrict({
        creator: creator.publicKey,
        config: CONFIG,
        season: SEASON0,
        vault: VAULT,
        registry: REGISTRY,
        machine: k.machine,
        curve: k.curve,
        coinMint: k.coinMint,
        vaultToken: VAULT_TOKEN,
        creatorUsdc: usdcOf(creator.publicKey),
        usdcMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        coinTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  };

  const coinAta = (id: number, who: PublicKey) => getAssociatedTokenAddressSync(machineKeys(id).coinMint, who);
  const tradeAccounts = (id: number, who: PublicKey) => {
    const k = machineKeys(id);
    return {
      user: who,
      config: CONFIG,
      vault: VAULT,
      machine: k.machine,
      curve: k.curve,
      coinMint: k.coinMint,
      userCoin: coinAta(id, who),
      userUsdc: usdcOf(who),
      vaultToken: VAULT_TOKEN,
      usdcMint: mint.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      coinTokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  };
  /** `usdc` is in base units. */
  const coinBuyIx = (id: number, who: PublicKey, usdc: number, minOut = 0) =>
    program.methods.coinBuy(new BN(usdc), new BN(minOut)).accountsStrict(tradeAccounts(id, who)).instruction();
  const coinSellIx = (id: number, who: PublicKey, coins: number | BN, minOut = 0) =>
    program.methods.coinSell(new BN(coins), new BN(minOut)).accountsStrict(tradeAccounts(id, who)).instruction();
  const coinsOf = (id: number, who: PublicKey) => tokenBalance(coinAta(id, who));

  const packKey = (nonce: BN) => pda([Buffer.from("pack"), user.publicKey.toBuffer(), u64(nonce)]);
  /** `curve` defaults to the machine's own curve for launchpad machines and none for official ones. */
  const buyIx = (id: number, nonce: BN, count: number, curve: PublicKey | null = launched.includes(id) ? machineKeys(id).curve : null) =>
    program.methods
      .buyPacks(nonce, count, Array(32).fill(9))
      .accountsStrict({
        payer: user.publicKey,
        user: user.publicKey,
        config: CONFIG,
        vault: VAULT,
        machine: machineKeys(id).machine,
        curve,
        season: SEASON0,
        player: playerOf(user.publicKey),
        pack: packKey(nonce),
        userUsdc,
        vaultToken: VAULT_TOKEN,
        usdcMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        oracleQueue: QUEUE,
        programIdentity: PROGRAM_IDENTITY,
        vrfProgram: VRF_ID,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  const callbackIx = (
    id: number,
    nonce: BN,
    randomness: number[],
    o: { identity?: PublicKey; curve?: PublicKey | null } = {},
  ) =>
    program.methods
      .callbackOpen(randomness)
      .accountsStrict({
        vrfProgramIdentity: o.identity ?? SCOPED_VRF_IDENTITY,
        pack: packKey(nonce),
        machine: machineKeys(id).machine,
        season: SEASON0,
        player: playerOf(user.publicKey),
        vault: VAULT,
        curve: o.curve !== undefined ? o.curve : launched.includes(id) ? machineKeys(id).curve : null,
      })
      .instruction();
  const packAccounts = (id: number, nonce: BN, coin: { mint: PublicKey; ata: PublicKey } | null = null) => ({
    owner: user.publicKey,
    config: CONFIG,
    season: SEASON0,
    vault: VAULT,
    machine: machineKeys(id).machine,
    pack: packKey(nonce),
    rentPayer: user.publicKey,
    userUsdc,
    vaultToken: VAULT_TOKEN,
    usdcMint: mint.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    coinMint: coin?.mint ?? null,
    userCoin: coin?.ata ?? null,
    coinTokenProgram: TOKEN_PROGRAM_ID,
  });
  const claimIx = (id: number, nonce: BN, coin: Parameters<typeof packAccounts>[2] = null) =>
    program.methods.claim().accountsStrict(packAccounts(id, nonce, coin)).instruction();
  /** Buys a pack, plays the oracle, and returns the revealed pack. */
  const pull = async (id: number, nonce: number, count: number, randomByte: number) => {
    const n = new BN(nonce);
    ok(send([await buyIx(id, n, count)], [user]));
    ok(send([await callbackIx(id, n, Array(32).fill(randomByte))], [user], [SCOPED_VRF_IDENTITY]));
    return decode<PackAcc>("pack", packKey(n));
  };

  before(async () => {
    // Our program as an upgradeable program whose upgrade authority is `admin`
    const elf = readFileSync(`${ROOT}/target/deploy/kaigu_gacha.so`);
    const programAcc = Buffer.alloc(36);
    programAcc.writeUInt32LE(2, 0);
    PROGRAM_DATA.toBuffer().copy(programAcc, 4);
    const dataHeader = Buffer.alloc(45);
    dataHeader.writeUInt32LE(3, 0);
    dataHeader.writeUInt8(1, 12);
    admin.publicKey.toBuffer().copy(dataHeader, 13);
    const programData = Buffer.concat([dataHeader, elf]);
    svm.setAccount(PROGRAM_DATA, { lamports: 10 * LAMPORTS_PER_SOL, data: programData, owner: LOADER, executable: false });
    svm.setAccount(PROGRAM_ID, { lamports: LAMPORTS_PER_SOL, data: programAcc, owner: LOADER, executable: true });

    // The real VRF program and oracle queue from devnet
    svm.addProgramFromFile(VRF_ID, `${ROOT}/tests/fixtures/vrf.so`);
    const q = JSON.parse(readFileSync(`${ROOT}/tests/fixtures/queue.json`, "utf8")).account;
    svm.setAccount(QUEUE, {
      lamports: q.lamports,
      data: Buffer.from(q.data[0], "base64"),
      owner: new PublicKey(q.owner),
      executable: false,
    });

    svm.airdrop(admin.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    ok(
      send(
        [
          SystemProgram.createAccount({
            fromPubkey: admin.publicKey,
            newAccountPubkey: mint.publicKey,
            lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
            space: MINT_SIZE,
            programId: TOKEN_PROGRAM_ID,
          }),
          createInitializeMint2Instruction(mint.publicKey, 6, admin.publicKey, null),
        ],
        [admin, mint],
      ),
    );
    fund(user, 50_000);
    fund(creator, 1_000);
    fund(treasury, 0);
  });

  it("only lets the upgrade authority initialize, publishes season 0 and opens the vault", async () => {
    const init = (signer: PublicKey) =>
      program.methods
        .initialize(treasury.publicKey)
        .accountsStrict({
          admin: signer,
          config: CONFIG,
          usdcMint: mint.publicKey,
          program: PROGRAM_ID,
          programData: PROGRAM_DATA,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    fails(send([await init(user.publicKey)], [user]), "Unauthorized");
    ok(send([await init(admin.publicKey)], [admin]));

    const season = await program.methods
      .createSeason({
        packPrice: new BN(10 * USDC),
        feeBps: 700,
        poolBps: 1_800,
        settleFeeBps: 100,
        capBps: 2_500,
        jackpotShareBps: 5_000,
        pity: 60,
        timeoutSlots: new BN(1_500),
        jackpotMinPool: new BN(2_000 * USDC),
        tiers: TIERS.map(([p, cents]) => ({ probPpm: p, bonus: new BN(cents * 10_000) })),
        whitelist: Array.from({ length: 11 }, () => Keypair.generate().publicKey),
      })
      .accountsStrict({ admin: admin.publicKey, config: CONFIG, season: SEASON0, systemProgram: SystemProgram.programId })
      .instruction();
    ok(send([season], [admin]));
    assert.equal(decode<{ paused: boolean }>("config", CONFIG).paused, false);

    const initVault = (signer: PublicKey) =>
      program.methods
        .initVault()
        .accountsStrict({
          admin: signer,
          config: CONFIG,
          vault: VAULT,
          vaultToken: VAULT_TOKEN,
          usdcMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    fails(send([await initVault(user.publicKey)], [user]), "Unauthorized");
    ok(send([await initVault(admin.publicKey)], [admin]));
    assertSolvent();
  });

  describe("official machine on the shared pool", () => {
    it("is created by the admin only", async () => {
      fails(send([await createMachineIx(0, user.publicKey)], [user]), "Unauthorized");
      ok(send([await createMachineIx(0, admin.publicKey)], [admin]));
      assert.ok("official" in machine(0).kind);
    });

    it("buys a 10-pack, CPIs into MagicBlock VRF, and settles in the callback", async () => {
      const queueBefore = Buffer.from(svm.getAccount(QUEUE)!.data);
      const nonce = new BN(1);
      const before = tokenBalance(userUsdc);
      const buy = ok(send([await buyIx(0, nonce, 10)], [user]));
      assert.ok(buy.logs().some((l) => l.includes(`Program ${VRF_ID.toBase58()} success`)), "VRF CPI did not succeed");
      assert.notDeepEqual(Buffer.from(svm.getAccount(QUEUE)!.data), queueBefore, "queue should hold the new request");
      assert.equal(vault().pending.toNumber(), 100 * USDC);
      assertSolvent();

      // Only the scoped VRF identity may call the callback
      const impostor = Keypair.generate();
      svm.airdrop(impostor.publicKey, BigInt(LAMPORTS_PER_SOL));
      fails(send([await callbackIx(0, nonce, Array(32).fill(1), { identity: impostor.publicKey })], [impostor]), "ConstraintAddress");

      ok(send([await callbackIx(0, nonce, Array(32).fill(1))], [user], [SCOPED_VRF_IDENTITY]));
      const p = decode<PackAcc>("pack", packKey(nonce));
      assert.ok("revealed" in p.status);
      const total = p.results.slice(0, 10).reduce((s, r) => s + r.value.toNumber(), 0);
      assert.equal(p.lockedAmount.toNumber(), total);
      assert.equal(p.coins.toNumber(), 0);
      for (const r of p.results.slice(0, 10)) {
        assert.ok([2, 3, 4].includes(r.stockIdx), "stock must come from the machine's basket");
        assert.ok(r.value.toNumber() >= 7.5 * USDC, "every pull is worth at least the floor");
      }
      const v = vault();
      assert.equal(v.pending.toNumber(), 0);
      assert.equal(v.totalPulls.toNumber(), 10);
      assert.equal(machine(0).totalPulls.toNumber(), 10);
      // Official machines: 0.40 per pull to the protocol, 2.10 to the pool, nothing to a coin or a creator
      assert.equal(v.protocolFees.toNumber(), 4 * USDC);
      assert.equal(v.markets.toNumber(), 0);
      assert.equal(v.prizePool.toNumber() + v.locked.toNumber(), 96 * USDC);
      assertSolvent();

      // A second callback for the same pack is rejected
      fails(send([await callbackIx(0, nonce, Array(32).fill(2))], [user], [SCOPED_VRF_IDENTITY]), "BadStatus");

      // Claim pays out minus 1% and closes the pack
      ok(send([await claimIx(0, nonce)], [user]));
      assert.equal(tokenBalance(userUsdc), before - 100 * USDC + total - Math.floor(total / 100));
      assert.equal(svm.getAccount(packKey(nonce))?.lamports ?? 0, 0);
      assert.equal(vault().locked.toNumber(), 0);
      assertSolvent();
    });

    it("refunds a pack whose callback never arrives, but only after the timeout", async () => {
      const nonce = new BN(2);
      const before = tokenBalance(userUsdc);
      ok(send([await buyIx(0, nonce, 1)], [user]));
      const refund = await program.methods.refundTimeout().accountsStrict(packAccounts(0, nonce)).instruction();
      fails(send([refund], [user]), "TooEarly");
      svm.warpToSlot(svm.getClock().slot + 1_501n);
      ok(send([refund], [user]));
      assert.equal(tokenBalance(userUsdc), before);
      assert.equal(vault().pending.toNumber(), 0);
      assertSolvent();
    });

    it("lets anyone add to the prize pool", async () => {
      const pool = vault().prizePool.toNumber();
      const ix = await program.methods
        .fundPool(new BN(500 * USDC))
        .accountsStrict({
          funder: user.publicKey,
          config: CONFIG,
          vault: VAULT,
          vaultToken: VAULT_TOKEN,
          funderUsdc: userUsdc,
          usdcMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
      ok(send([ix], [user]));
      assert.equal(vault().prizePool.toNumber(), pool + 500 * USDC);
      assertSolvent();
    });

    it("pays protocol fees to the treasury and nothing else leaves the vault", async () => {
      const v = vault();
      const withdraw = (dest: PublicKey) =>
        program.methods
          .withdrawProtocolFees()
          .accountsStrict({
            payer: user.publicKey,
            config: CONFIG,
            vault: VAULT,
            vaultToken: VAULT_TOKEN,
            treasuryUsdc: dest,
            usdcMint: mint.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();
      // The destination is fixed: a caller cannot redirect it
      fails(send([await withdraw(userUsdc)], [user]), "ConstraintTokenOwner");
      ok(send([await withdraw(usdcOf(treasury.publicKey))], [user]));
      assert.equal(tokenBalance(usdcOf(treasury.publicKey)), v.protocolFees.toNumber());
      assert.equal(vault().prizePool.toNumber(), v.prizePool.toNumber());
      assertSolvent();
      fails(send([await withdraw(usdcOf(treasury.publicKey))], [user]), "NothingToWithdraw");
    });
  });

  describe("launchpad machine and its coin", () => {
    const ID = 1;
    const coin = () => ({ mint: machineKeys(ID).coinMint, ata: coinAta(ID, user.publicKey) });
    const createAta = (who: PublicKey) =>
      createAssociatedTokenAccountInstruction(user.publicKey, coinAta(ID, who), who, machineKeys(ID).coinMint);

    it("launches for a fee and rejects bad parameters", async () => {
      fails(send([await launchIx(ID, { symbol: "bad" })], [creator]), "BadMachine");
      fails(send([await launchIx(ID, { basket: [11] })], [creator]), "BadMachine");
      const before = tokenBalance(usdcOf(creator.publicKey));
      const fees = vault().protocolFees.toNumber();
      ok(send([await launchIx(ID)], [creator]));
      launched.push(ID);
      assert.ok("launchpad" in machine(ID).kind);
      assert.equal(before - tokenBalance(usdcOf(creator.publicKey)), 10 * USDC);
      assert.equal(vault().protocolFees.toNumber() - fees, 10 * USDC);
      assert.equal(coinSupply(ID), 0);
      assertSolvent();
    });

    it("is open for pulls right away, and every pull buys the coin for the player", async () => {
      const v0 = vault();
      const nonce = new BN(100);
      // The callback needs the machine's curve, so the purchase must bring it
      fails(send([await buyIx(ID, nonce, 10, null)], [user]), "BadCoinAccount");
      fails(send([await buyIx(ID, nonce, 10, machineKeys(0).curve)], [user]), "AccountNotInitialized");
      ok(send([await buyIx(ID, nonce, 10)], [user]));
      fails(send([await callbackIx(ID, nonce, Array(32).fill(3), { curve: null })], [user], [SCOPED_VRF_IDENTITY]), "BadCoinAccount");
      ok(send([await callbackIx(ID, nonce, Array(32).fill(3))], [user], [SCOPED_VRF_IDENTITY]));

      const p = decode<PackAcc>("pack", packKey(nonce));
      const [v, m, c] = [vault(), machine(ID), curve(ID)];
      // 10 pulls: 3.00 bought the coin, 1.00 for the creator, 3.00 for the protocol, 18.00 into the pool
      assert.equal(m.marketUsdc.toNumber(), 3 * USDC);
      assert.equal(m.creatorAccrued.toNumber(), 1 * USDC);
      assert.equal(v.protocolFees.toNumber() - v0.protocolFees.toNumber(), 3 * USDC);
      assert.equal(v.prizePool.toNumber() + v.locked.toNumber() - v0.prizePool.toNumber(), 93 * USDC);
      // 3 USDC at the opening price of 0.00000125 buys just under 2.4M coins
      const coins = p.coins.toNumber();
      assert.ok(coins > 2_390_000 * COIN && coins < 2_400_000 * COIN, `coins ${coins / COIN}`);
      assert.equal(c.sold.toNumber(), coins);
      assert.equal(c.rebatedCoins.toNumber(), coins);
      assert.equal(c.rebatedUsdc.toNumber(), 3 * USDC);
      // Bought but not minted until the pack is claimed
      assert.equal(coinSupply(ID), 0);
      assertSolvent();

      // The claim needs the owner's own coin account
      fails(send([await claimIx(ID, nonce)], [user]), "BadCoinAccount");
      ok(send([createAta(user.publicKey), createAta(creator.publicKey)], [user]));
      fails(send([await claimIx(ID, nonce, { mint: coin().mint, ata: coinAta(ID, creator.publicKey) })], [user]), "BadCoinAccount");
      fails(send([await claimIx(ID, nonce, { mint: mint.publicKey, ata: coin().ata })], [user]), "ConstraintAddress");
      const before = tokenBalance(userUsdc);
      ok(send([await claimIx(ID, nonce, coin())], [user]));
      const total = p.lockedAmount.toNumber();
      assert.equal(tokenBalance(userUsdc) - before, total - Math.floor(total / 100));
      assert.equal(coinsOf(ID, user.publicKey), coins);
      assert.equal(coinSupply(ID), coins);
      assertSolvent();
    });

    it("caps early purchases and the creator's allocation", async () => {
      fails(send([await coinBuyIx(ID, user.publicKey, 101 * USDC)], [user]), "EarlyCap");
      ok(send([await coinBuyIx(ID, user.publicKey, 100 * USDC)], [user]));
      svm.warpToSlot(svm.getClock().slot + 200n);
      // 5% of the curve allocation is 40M coins; at these prices 200 USDC would buy far more
      fails(send([await coinBuyIx(ID, creator.publicKey, 200 * USDC)], [creator]), "CreatorCap");
      ok(send([await coinBuyIx(ID, creator.publicKey, 20 * USDC)], [creator]));
      assert.ok(curve(ID).creatorBought.toNumber() > 0);
      assertSolvent();
    });

    it("trades along the curve with a 1% fee and slippage protection", async () => {
      const before = tokenBalance(userUsdc);
      const coinsBefore = coinsOf(ID, user.publicKey);
      const fees = vault().protocolFees.toNumber();
      fails(send([await coinBuyIx(ID, user.publicKey, 1_000 * USDC, CURVE_SUPPLY)], [user]), "Slippage");
      ok(send([await coinBuyIx(ID, user.publicKey, 1_000 * USDC)], [user]));
      const bought = coinsOf(ID, user.publicKey) - coinsBefore;
      assert.ok(bought > 0);
      assert.equal(before - tokenBalance(userUsdc), 1_000 * USDC);
      const fee = vault().protocolFees.toNumber() - fees;
      assert.ok(Math.abs(fee - 1_000 * USDC * (100 / 10_100)) < 2, `fee ${fee}`);
      assert.equal(coinSupply(ID), curve(ID).sold.toNumber());

      // Selling straight back costs the two fees and nothing more
      ok(send([await coinSellIx(ID, user.publicKey, bought)], [user]));
      const lost = before - tokenBalance(userUsdc);
      assert.ok(lost > 19 * USDC && lost < 20 * USDC, `round trip cost ${lost / USDC}`);
      assertSolvent();
    });

    it("graduates when the curve sells out, and the whole raise stays with the coin", async () => {
      const before = tokenBalance(userUsdc);
      const raisedBefore = machine(ID).marketUsdc.toNumber();
      const pool = vault().prizePool.toNumber();
      // Far more than needed: only the remainder is filled and charged
      ok(send([await coinBuyIx(ID, user.publicKey, 10_000 * USDC)], [user]));
      const m = machine(ID);
      const c = curve(ID);
      assert.ok(c.graduated);
      assert.equal(c.sold.toNumber(), CURVE_SUPPLY);
      assert.equal(coinSupply(ID), CURVE_SUPPLY);
      // Nothing from the raise goes to the prize pool
      assert.equal(vault().prizePool.toNumber(), pool);
      const dust = m.marketUsdc.toNumber() - 5_000 * USDC;
      assert.ok(dust >= 0 && dust < 10, `pool USDC ${m.marketUsdc.toNumber()}`);
      assert.ok(Math.abs(c.poolCoins.toNumber() - 160_000_000 * COIN) < COIN, `pool coins ${c.poolCoins.toNumber()}`);
      const paid = before - tokenBalance(userUsdc);
      const needed = 5_000 * USDC - raisedBefore;
      assert.ok(paid >= needed && paid <= needed * 1.0101 + 10, `paid ${paid} for ${needed}`);
      assertSolvent();
    });

    it("keeps buying the coin for players from the pool after graduation, which lifts its price", async () => {
      const [m0, c0] = [machine(ID), curve(ID)];
      const price0 = m0.marketUsdc.toNumber() / c0.poolCoins.toNumber();
      const held = coinsOf(ID, user.publicKey);
      const p = await pull(ID, 101, 10, 5);
      const [m, c] = [machine(ID), curve(ID)];
      const coins = p.coins.toNumber();
      // 3 USDC at the graduation price of 0.00003125 buys just under 96,000 coins
      assert.ok(coins > 95_000 * COIN && coins < 96_000 * COIN, `coins ${coins / COIN}`);
      assert.equal(m.marketUsdc.toNumber(), m0.marketUsdc.toNumber() + 3 * USDC);
      assert.equal(c.poolCoins.toNumber(), c0.poolCoins.toNumber() - coins);
      assert.ok(m.marketUsdc.toNumber() / c.poolCoins.toNumber() > price0);
      ok(send([await claimIx(ID, new BN(101), coin())], [user]));
      assert.equal(coinsOf(ID, user.publicKey), held + coins);
      assert.equal(coinSupply(ID), CURVE_SUPPLY + coins);
      assertSolvent();
    });

    it("keeps trading against the pool after graduation", async () => {
      const coins = coinsOf(ID, user.publicKey);
      const supply = coinSupply(ID);
      const before = tokenBalance(userUsdc);
      ok(send([await coinSellIx(ID, user.publicKey, 10_000_000 * COIN)], [user]));
      const got = tokenBalance(userUsdc) - before;
      assert.ok(got > 0);
      assert.equal(coinsOf(ID, user.publicKey), coins - 10_000_000 * COIN);
      assert.equal(coinSupply(ID), supply - 10_000_000 * COIN);
      ok(send([await coinBuyIx(ID, user.publicKey, 50 * USDC)], [user]));
      assert.ok(coinsOf(ID, user.publicKey) > coins - 10_000_000 * COIN);
      assertSolvent();
    });

    it("pays the creator's share to the creator only", async () => {
      const m = machine(ID);
      const v = vault();
      const c0 = tokenBalance(usdcOf(creator.publicKey));
      const withdraw = (dest: PublicKey) =>
        program.methods
          .withdrawCreatorFees()
          .accountsStrict({
            payer: user.publicKey,
            config: CONFIG,
            vault: VAULT,
            machine: machineKeys(ID).machine,
            vaultToken: VAULT_TOKEN,
            creatorUsdc: dest,
            usdcMint: mint.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();
      fails(send([await withdraw(userUsdc)], [user]), "ConstraintTokenOwner");
      ok(send([await withdraw(usdcOf(creator.publicKey))], [user]));
      assert.equal(m.creatorAccrued.toNumber(), 2 * USDC);
      assert.equal(tokenBalance(usdcOf(creator.publicKey)) - c0, 2 * USDC);
      const after = machine(ID);
      assert.equal(after.creatorAccrued.toNumber(), 0);
      assert.equal(after.marketUsdc.toNumber(), m.marketUsdc.toNumber());
      assert.equal(vault().prizePool.toNumber(), v.prizePool.toNumber());
      assertSolvent();
      fails(send([await withdraw(usdcOf(creator.publicKey))], [user]), "NothingToWithdraw");
    });
  });

  describe("a coin that graduates on a pull", () => {
    const ID = 2;

    it("crosses from the curve into the pool inside the draw callback", async () => {
      ok(send([await launchIx(ID, { name: "Almost There", symbol: "SOON" })], [creator]));
      launched.push(ID);
      svm.warpToSlot(svm.getClock().slot + 200n);
      // Leave the curve 0.20 USDC short of selling out
      ok(send([await coinBuyIx(ID, user.publicKey, Math.floor(4_999.8 * USDC * 1.01))], [user]));
      const short = 5_000 * USDC - machine(ID).marketUsdc.toNumber();
      assert.ok(!curve(ID).graduated && short > 0.19 * USDC && short < 0.21 * USDC, `short by ${short}`);
      const left = CURVE_SUPPLY - curve(ID).sold.toNumber();

      // One pull spends 0.30: about 0.20 finishes the curve and the rest buys from the new pool
      const p = await pull(ID, 200, 1, 7);
      const [m, c] = [machine(ID), curve(ID)];
      assert.ok(c.graduated);
      assert.equal(c.sold.toNumber(), CURVE_SUPPLY);
      assert.ok(p.coins.toNumber() > left, "the pull bought the rest of the curve and some of the pool");
      assert.ok(Math.abs(c.poolCoins.toNumber() + p.coins.toNumber() - left - 160_000_000 * COIN) < COIN);
      assert.equal(m.marketUsdc.toNumber(), 5_000 * USDC - short + 0.3 * USDC);
      assertSolvent();

      // A machine can only pay out of its own market, however many coins come back
      const all = coinsOf(ID, user.publicKey);
      const before = tokenBalance(userUsdc);
      const other = machine(1).marketUsdc.toNumber();
      ok(send([await coinSellIx(ID, user.publicKey, all)], [user]));
      assert.ok(tokenBalance(userUsdc) - before < m.marketUsdc.toNumber());
      assert.equal(machine(1).marketUsdc.toNumber(), other);
      assertSolvent();
    });
  });

  it("pauses purchases, launches and coin buys without blocking exits", async () => {
    const pause = await program.methods.setPaused(true).accountsStrict({ admin: admin.publicKey, config: CONFIG }).instruction();
    ok(send([pause], [admin]));
    fails(send([await buyIx(0, new BN(70), 1)], [user]), "Paused");
    fails(send([await launchIx(3, { symbol: "LATE" })], [creator]), "Paused");
    fails(send([await coinBuyIx(1, user.publicKey, 10 * USDC)], [user]), "Paused");
    ok(send([await coinSellIx(1, user.publicKey, 1_000 * COIN)], [user]));
    ok(send([await claimIx(2, new BN(200), { mint: machineKeys(2).coinMint, ata: coinAta(2, user.publicKey) })], [user]));
    assertSolvent();
  });
});
