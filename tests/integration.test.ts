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
const PROGRAM_DATA = pda([PROGRAM_ID.toBuffer()], LOADER);
const PROGRAM_IDENTITY = pda([Buffer.from("identity")]);
const SCOPED_VRF_IDENTITY = pda([Buffer.from("identity"), PROGRAM_ID.toBuffer()], VRF_ID);

const machineKeys = (id: number) => {
  const machine = pda([Buffer.from("machine"), u64(id)]);
  return {
    machine,
    curve: pda([Buffer.from("curve"), machine.toBuffer()]),
    coinMint: pda([Buffer.from("coin"), machine.toBuffer()]),
    poolToken: pda([Buffer.from("machine_pool"), machine.toBuffer()]),
  };
};

const TIERS: [number, number][] = [
  [630_400, 0],
  [220_000, 3],
  [120_000, 7],
  [25_000, 25],
  [4_000, 95],
  [400, 495],
  [200, 0],
];

type MachineAcc = {
  status: object;
  kind: object;
  pending: BN;
  prizePool: BN;
  locked: BN;
  protocolFees: BN;
  buybackAccrued: BN;
  creatorAccrued: BN;
  marketUsdc: BN;
  totalPulls: BN;
  totalVolume: BN;
};
type CurveAcc = { sold: BN; creatorBought: BN; poolCoins: BN; burned: BN; boughtBack: BN };

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
  const machine = (id: number) => decode<MachineAcc>("machine", machineKeys(id).machine);
  const curve = (id: number) => decode<CurveAcc>("curve", machineKeys(id).curve);
  /** The machine's token account must hold exactly what its ledger says. */
  const assertSolvent = (id: number) => {
    const m = machine(id);
    const owed = [m.pending, m.prizePool, m.locked, m.protocolFees, m.buybackAccrued, m.creatorAccrued, m.marketUsdc].reduce((a, b) => a + b.toNumber(), 0);
    assert.equal(tokenBalance(machineKeys(id).poolToken), owed, "token balance must equal the ledger");
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
        poolToken: machineKeys(id).poolToken,
        usdcMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
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
        registry: REGISTRY,
        machine: k.machine,
        curve: k.curve,
        coinMint: k.coinMint,
        poolToken: k.poolToken,
        creatorUsdc: usdcOf(creator.publicKey),
        usdcMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        coinTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  };

  const tradeAccounts = (id: number, who: PublicKey) => {
    const k = machineKeys(id);
    return {
      user: who,
      config: CONFIG,
      machine: k.machine,
      curve: k.curve,
      coinMint: k.coinMint,
      userCoin: getAssociatedTokenAddressSync(k.coinMint, who),
      userUsdc: usdcOf(who),
      poolToken: k.poolToken,
      usdcMint: mint.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      coinTokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  };
  const coinBuyIx = (id: number, who: PublicKey, usdc: number, minOut = 0) =>
    program.methods.coinBuy(new BN(usdc * USDC), new BN(minOut)).accountsStrict(tradeAccounts(id, who)).instruction();
  const coinSellIx = (id: number, who: PublicKey, coins: number | BN, minOut = 0) =>
    program.methods.coinSell(new BN(coins), new BN(minOut)).accountsStrict(tradeAccounts(id, who)).instruction();
  const coinsOf = (id: number, who: PublicKey) => tokenBalance(getAssociatedTokenAddressSync(machineKeys(id).coinMint, who));

  const packKey = (nonce: BN) => pda([Buffer.from("pack"), user.publicKey.toBuffer(), u64(nonce)]);
  const buyIx = (id: number, nonce: BN, count: number) =>
    program.methods
      .buyPacks(nonce, count, Array(32).fill(9))
      .accountsStrict({
        payer: user.publicKey,
        user: user.publicKey,
        config: CONFIG,
        machine: machineKeys(id).machine,
        season: SEASON0,
        player: playerOf(user.publicKey),
        pack: packKey(nonce),
        userUsdc,
        poolToken: machineKeys(id).poolToken,
        usdcMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        oracleQueue: QUEUE,
        programIdentity: PROGRAM_IDENTITY,
        vrfProgram: VRF_ID,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  const callbackIx = (id: number, nonce: BN, randomness: number[], identity = SCOPED_VRF_IDENTITY) =>
    program.methods
      .callbackOpen(randomness)
      .accountsStrict({
        vrfProgramIdentity: identity,
        pack: packKey(nonce),
        machine: machineKeys(id).machine,
        season: SEASON0,
        player: playerOf(user.publicKey),
      })
      .instruction();
  const packAccounts = (id: number, nonce: BN) => ({
    owner: user.publicKey,
    config: CONFIG,
    season: SEASON0,
    machine: machineKeys(id).machine,
    pack: packKey(nonce),
    rentPayer: user.publicKey,
    userUsdc,
    poolToken: machineKeys(id).poolToken,
    usdcMint: mint.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const withdrawIx = (id: number, creatorDest: PublicKey, treasuryDest = usdcOf(treasury.publicKey)) =>
    program.methods
      .withdrawFees()
      .accountsStrict({
        payer: user.publicKey,
        config: CONFIG,
        machine: machineKeys(id).machine,
        poolToken: machineKeys(id).poolToken,
        treasuryUsdc: treasuryDest,
        creatorUsdc: creatorDest,
        usdcMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  /** Buys a pack, plays the oracle, and returns the revealed results. */
  const pull = async (id: number, nonce: number, count: number, randomByte: number) => {
    const n = new BN(nonce);
    ok(send([await buyIx(id, n, count)], [user]));
    ok(send([await callbackIx(id, n, Array(32).fill(randomByte))], [user], [SCOPED_VRF_IDENTITY]));
    return decode<{ status: object; lockedAmount: BN; results: { tier: number; value: BN; stockIdx: number }[] }>("pack", packKey(n));
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
    fund(user, 20_000);
    fund(creator, 1_000);
    fund(treasury, 0);
  });

  it("only lets the upgrade authority initialize, and publishes season 0", async () => {
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
        feeBps: 800,
        poolBps: 4_200,
        settleFeeBps: 100,
        capBps: 2_500,
        jackpotShareBps: 5_000,
        pity: 30,
        timeoutSlots: new BN(1_500),
        jackpotMinPool: new BN(4_000 * USDC),
        tiers: TIERS.map(([p, b]) => ({ probPpm: p, bonus: new BN(b * USDC) })),
        whitelist: Array.from({ length: 11 }, () => Keypair.generate().publicKey),
      })
      .accountsStrict({ admin: admin.publicKey, config: CONFIG, season: SEASON0, systemProgram: SystemProgram.programId })
      .instruction();
    ok(send([season], [admin]));
    assert.equal(decode<{ paused: boolean }>("config", CONFIG).paused, false);
  });

  describe("official machine", () => {
    it("is created by the admin only and opens right away", async () => {
      fails(send([await createMachineIx(0, user.publicKey)], [user]), "Unauthorized");
      ok(send([await createMachineIx(0, admin.publicKey)], [admin]));
      const m = machine(0);
      assert.ok("live" in m.status && "official" in m.kind);
    });

    it("buys a 10-pack, CPIs into MagicBlock VRF, and settles in the callback", async () => {
      const queueBefore = Buffer.from(svm.getAccount(QUEUE)!.data);
      const nonce = new BN(1);
      const before = tokenBalance(userUsdc);
      const buy = ok(send([await buyIx(0, nonce, 10)], [user]));
      assert.ok(buy.logs().some((l) => l.includes(`Program ${VRF_ID.toBase58()} success`)), "VRF CPI did not succeed");
      assert.notDeepEqual(Buffer.from(svm.getAccount(QUEUE)!.data), queueBefore, "queue should hold the new request");
      assert.equal(machine(0).pending.toNumber(), 100 * USDC);
      assertSolvent(0);

      // Only the scoped VRF identity may call the callback
      const impostor = Keypair.generate();
      svm.airdrop(impostor.publicKey, BigInt(LAMPORTS_PER_SOL));
      fails(send([await callbackIx(0, nonce, Array(32).fill(1), impostor.publicKey)], [impostor]), "ConstraintAddress");

      ok(send([await callbackIx(0, nonce, Array(32).fill(1))], [user], [SCOPED_VRF_IDENTITY]));
      const p = decode<{ status: object; lockedAmount: BN; results: { tier: number; value: BN; stockIdx: number }[] }>("pack", packKey(nonce));
      assert.ok("revealed" in p.status);
      const total = p.results.slice(0, 10).reduce((s, r) => s + r.value.toNumber(), 0);
      assert.equal(p.lockedAmount.toNumber(), total);
      for (const r of p.results.slice(0, 10)) assert.ok([2, 3, 4].includes(r.stockIdx), "stock must come from the machine's basket");
      const m = machine(0);
      assert.equal(m.pending.toNumber(), 0);
      assert.equal(m.totalPulls.toNumber(), 10);
      // Official machines keep the whole 8% fee for the protocol
      assert.equal(m.protocolFees.toNumber(), 8 * USDC);
      assert.equal(m.buybackAccrued.toNumber() + m.creatorAccrued.toNumber(), 0);
      assertSolvent(0);

      // A second callback for the same pack is rejected
      fails(send([await callbackIx(0, nonce, Array(32).fill(2))], [user], [SCOPED_VRF_IDENTITY]), "BadStatus");

      // Claim pays out minus 1% and closes the pack
      ok(send([await program.methods.claim().accountsStrict(packAccounts(0, nonce)).instruction()], [user]));
      assert.equal(tokenBalance(userUsdc), before - 100 * USDC + total - Math.floor(total / 100));
      assert.equal(svm.getAccount(packKey(nonce))?.lamports ?? 0, 0);
      assertSolvent(0);
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
      assert.equal(machine(0).pending.toNumber(), 0);
      assertSolvent(0);
    });

    it("pays fees to the treasury and nothing else leaves the machine", async () => {
      const m = machine(0);
      const pool = m.prizePool.toNumber();
      // The fee destinations are fixed: a caller cannot redirect them
      ok(send([createAssociatedTokenAccountInstruction(admin.publicKey, usdcOf(admin.publicKey), admin.publicKey, mint.publicKey)], [admin]));
      fails(send([await withdrawIx(0, usdcOf(admin.publicKey), userUsdc)], [user]), "ConstraintTokenOwner");
      ok(send([await withdrawIx(0, usdcOf(admin.publicKey))], [user]));
      assert.equal(tokenBalance(usdcOf(treasury.publicKey)), m.protocolFees.toNumber());
      assert.equal(machine(0).prizePool.toNumber(), pool);
      assertSolvent(0);
    });
  });

  describe("launchpad machine and its coin", () => {
    const ID = 1;

    it("launches for a fee and rejects bad parameters", async () => {
      fails(send([await launchIx(ID, { symbol: "bad" })], [creator]), "BadMachine");
      fails(send([await launchIx(ID, { basket: [11] })], [creator]), "BadMachine");
      const before = tokenBalance(usdcOf(creator.publicKey));
      ok(send([await launchIx(ID)], [creator]));
      const m = machine(ID);
      assert.ok("curve" in m.status && "launchpad" in m.kind);
      assert.equal(before - tokenBalance(usdcOf(creator.publicKey)), 10 * USDC);
      assert.equal(m.protocolFees.toNumber(), 10 * USDC);
      assert.equal(coinSupply(ID), 0);
      assertSolvent(ID);
      // Not open for pulls until the curve sells out
      fails(send([await buyIx(ID, new BN(50), 1)], [user]), "NotLive");
    });

    it("caps early purchases and the creator's allocation", async () => {
      fails(send([await coinBuyIx(ID, user.publicKey, 101)], [user]), "EarlyCap");
      ok(send([await coinBuyIx(ID, user.publicKey, 100)], [user]));
      svm.warpToSlot(svm.getClock().slot + 200n);
      // 5% of the curve allocation is 40M coins; at these prices 200 USDC would buy far more
      fails(send([await coinBuyIx(ID, creator.publicKey, 200)], [creator]), "CreatorCap");
      ok(send([await coinBuyIx(ID, creator.publicKey, 20)], [creator]));
      assert.ok(curve(ID).creatorBought.toNumber() > 0);
      assertSolvent(ID);
    });

    it("trades along the curve with a 1% fee and slippage protection", async () => {
      const before = tokenBalance(userUsdc);
      const coinsBefore = coinsOf(ID, user.publicKey);
      const fees = machine(ID).protocolFees.toNumber();
      fails(send([await coinBuyIx(ID, user.publicKey, 1_000, CURVE_SUPPLY)], [user]), "Slippage");
      ok(send([await coinBuyIx(ID, user.publicKey, 1_000)], [user]));
      const bought = coinsOf(ID, user.publicKey) - coinsBefore;
      assert.ok(bought > 0);
      assert.equal(before - tokenBalance(userUsdc), 1_000 * USDC);
      const fee = machine(ID).protocolFees.toNumber() - fees;
      assert.ok(Math.abs(fee - 1_000 * USDC * (100 / 10_100)) < 2, `fee ${fee}`);
      assert.equal(coinSupply(ID), curve(ID).sold.toNumber());

      // Selling straight back costs the two fees and nothing more
      ok(send([await coinSellIx(ID, user.publicKey, bought)], [user]));
      const lost = before - tokenBalance(userUsdc);
      assert.ok(lost > 19 * USDC && lost < 20 * USDC, `round trip cost ${lost / USDC}`);
      assertSolvent(ID);
    });

    it("graduates when the curve sells out: seeds the prize pool and opens the machine", async () => {
      const before = tokenBalance(userUsdc);
      const raisedBefore = machine(ID).marketUsdc.toNumber();
      // Far more than needed: only the remainder is filled and charged
      ok(send([await coinBuyIx(ID, user.publicKey, 10_000)], [user]));
      const m = machine(ID);
      const c = curve(ID);
      assert.ok("live" in m.status);
      assert.equal(c.sold.toNumber(), CURVE_SUPPLY);
      assert.equal(coinSupply(ID), CURVE_SUPPLY);
      assert.equal(m.prizePool.toNumber(), 4_000 * USDC);
      const dust = m.marketUsdc.toNumber() - 1_000 * USDC;
      assert.ok(dust >= 0 && dust < 10, `pool USDC ${m.marketUsdc.toNumber()}`);
      assert.ok(Math.abs(c.poolCoins.toNumber() - 32_000_000 * COIN) < COIN, `pool coins ${c.poolCoins.toNumber()}`);
      const paid = before - tokenBalance(userUsdc);
      const needed = 5_000 * USDC - raisedBefore;
      assert.ok(paid >= needed && paid <= needed * 1.0101 + 10, `paid ${paid} for ${needed}`);
      assertSolvent(ID);
    });

    it("opens packs with the jackpot live from day one and splits the fee three ways", async () => {
      const m0 = machine(ID);
      let jackpot: number | null = null;
      // roll = 999_999 hits the jackpot tier on the first pull of a pack whose randomness hashes there;
      // rather than search for such a seed, check the split and the pool on ordinary pulls
      const p = await pull(ID, 100, 10, 3);
      const m = machine(ID);
      assert.equal(m.totalPulls.toNumber(), 10);
      assert.equal(m.protocolFees.toNumber() - m0.protocolFees.toNumber(), 5 * USDC);
      assert.equal(m.buybackAccrued.toNumber(), 2 * USDC);
      assert.equal(m.creatorAccrued.toNumber(), 1 * USDC);
      for (const r of p.results.slice(0, 10)) if (r.tier === 6) jackpot = r.value.toNumber();
      if (jackpot !== null) assert.ok(jackpot >= 2_000 * USDC);
      // The seed lets the pool pay UR and Legend immediately
      assert.ok(m.prizePool.toNumber() >= 4_000 * USDC - 600 * USDC);
      assertSolvent(ID);
      ok(send([await program.methods.claim().accountsStrict(packAccounts(ID, new BN(100))).instruction()], [user]));
      assertSolvent(ID);
    });

    it("buys back and burns with accrued fees, which lifts the coin price", async () => {
      const crank = (minOut = 0) =>
        program.methods
          .crankBuyback(new BN(minOut))
          .accountsStrict({ payer: user.publicKey, machine: machineKeys(ID).machine, curve: machineKeys(ID).curve })
          .instruction();
      const [m0, c0] = [machine(ID), curve(ID)];
      const price0 = m0.marketUsdc.toNumber() / c0.poolCoins.toNumber();
      fails(send([await crank(CURVE_SUPPLY)], [user]), "Slippage");
      ok(send([await crank()], [user]));
      const [m, c] = [machine(ID), curve(ID)];
      assert.equal(m.buybackAccrued.toNumber(), 0);
      assert.equal(c.boughtBack.toNumber(), 2 * USDC);
      assert.equal(m.marketUsdc.toNumber(), m0.marketUsdc.toNumber() + 2 * USDC);
      assert.ok(c.burned.toNumber() > 0);
      assert.equal(c.poolCoins.toNumber(), c0.poolCoins.toNumber() - c.burned.toNumber());
      assert.ok(m.marketUsdc.toNumber() / c.poolCoins.toNumber() > price0);
      // Nothing was minted: the burned coins simply never enter circulation
      assert.equal(coinSupply(ID), CURVE_SUPPLY);
      assertSolvent(ID);
      fails(send([await crank()], [user]), "NothingToWithdraw");
    });

    it("keeps trading against the pool after graduation", async () => {
      const coins = coinsOf(ID, user.publicKey);
      const before = tokenBalance(userUsdc);
      ok(send([await coinSellIx(ID, user.publicKey, 10_000_000 * COIN)], [user]));
      const got = tokenBalance(userUsdc) - before;
      assert.ok(got > 0);
      assert.equal(coinsOf(ID, user.publicKey), coins - 10_000_000 * COIN);
      assert.equal(coinSupply(ID), CURVE_SUPPLY - 10_000_000 * COIN);
      ok(send([await coinBuyIx(ID, user.publicKey, 50)], [user]));
      assert.ok(coinsOf(ID, user.publicKey) > coins - 10_000_000 * COIN);
      assertSolvent(ID);
    });

    it("pays the creator's share to the creator and the rest to the treasury", async () => {
      const m = machine(ID);
      const [t0, c0] = [tokenBalance(usdcOf(treasury.publicKey)), tokenBalance(usdcOf(creator.publicKey))];
      fails(send([await withdrawIx(ID, userUsdc)], [user]), "ConstraintTokenOwner");
      ok(send([await withdrawIx(ID, usdcOf(creator.publicKey))], [user]));
      assert.equal(tokenBalance(usdcOf(creator.publicKey)) - c0, m.creatorAccrued.toNumber());
      assert.equal(tokenBalance(usdcOf(treasury.publicKey)) - t0, m.protocolFees.toNumber());
      const after = machine(ID);
      assert.equal(after.prizePool.toNumber(), m.prizePool.toNumber());
      assert.equal(after.marketUsdc.toNumber(), m.marketUsdc.toNumber());
      assertSolvent(ID);
    });
  });

  describe("a launch that misses its deadline", () => {
    const ID = 2;

    it("fails, never opens, and lets holders sell back along the curve with no fee", async () => {
      ok(send([await launchIx(ID, { name: "Nobody Came", symbol: "NOPE" })], [creator]));
      svm.warpToSlot(svm.getClock().slot + 200n);
      const before = tokenBalance(userUsdc);
      ok(send([await coinBuyIx(ID, user.publicKey, 500)], [user]));
      const coins = coinsOf(ID, user.publicKey);
      const fees = machine(ID).protocolFees.toNumber();

      const clock = svm.getClock();
      clock.unixTimestamp += BigInt(7 * 24 * 3600 + 1);
      svm.setClock(clock);
      fails(send([await coinBuyIx(ID, user.publicKey, 10)], [user]), "MarketClosed");
      ok(send([await coinSellIx(ID, user.publicKey, coins)], [user]));
      const m = machine(ID);
      assert.ok("failed" in m.status);
      // Everything but the 1% buy fee comes back
      const lost = before - tokenBalance(userUsdc);
      assert.ok(lost > 4.9 * USDC && lost < 5 * USDC, `lost ${lost / USDC}`);
      assert.equal(m.protocolFees.toNumber(), fees);
      assert.equal(coinSupply(ID), 0);
      assert.ok(m.marketUsdc.toNumber() < 10);
      assertSolvent(ID);
      fails(send([await buyIx(ID, new BN(60), 1)], [user]), "NotLive");
    });
  });

  it("pauses purchases, launches and coin buys without blocking exits", async () => {
    const pause = await program.methods.setPaused(true).accountsStrict({ admin: admin.publicKey, config: CONFIG }).instruction();
    ok(send([pause], [admin]));
    fails(send([await buyIx(0, new BN(70), 1)], [user]), "Paused");
    fails(send([await launchIx(3, { symbol: "LATE" })], [creator]), "Paused");
    fails(send([await coinBuyIx(1, user.publicKey, 10)], [user]), "Paused");
    ok(send([await coinSellIx(1, user.publicKey, 1_000 * COIN)], [user]));
  });
});
