// Browser end-to-end test of chain mode on devnet. Injects a Wallet Standard test wallet
// backed by .keys/e2e.json, then connects, uses the faucet, opens packs and claims.
// Usage: node browser-e2e.mjs [--launch] [--inventory] [http://localhost:3210]
//   --launch also launches a machine, plays it right away (each pull buys its coin for the
//   player), buys out its curve from a second wallet, sells the coin and withdraws the
//   creator's fees.
// The dev server must be running with web/.env.local pointing at devnet.

import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const WITH_LAUNCH = args.includes("--launch");
// --inventory skips straight to claiming whatever is waiting in Inventory
const INVENTORY_ONLY = args.includes("--inventory");
const BASE = args.find((a) => a.startsWith("http")) ?? "http://localhost:3210";
const SHOTS = `${ROOT}/tests/shots`;
mkdirSync(SHOTS, { recursive: true });
const key = (name) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${ROOT}/.keys/${name}.json`, "utf8"))));
const kp = key("e2e");
const mint = key("usdc-mint").publicKey;
const connection = new Connection("https://api.devnet.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true });
// The public devnet RPC rate-limits by IP, so retry reads instead of failing the run
const usdc = async () => {
  for (let attempt = 0; ; attempt++) {
    try {
      return Number((await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, kp.publicKey))).value.amount) / 1e6;
    } catch (e) {
      if (attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A second wallet (the faucet key) buys whatever is left on a machine's curve, so it graduates. */
async function buyOutCurve(machineId) {
  const { AnchorProvider, BN, Program, Wallet } = anchor;
  const buyer = key("faucet");
  const idl = JSON.parse(readFileSync(`${ROOT}/target/idl/kaigu_gacha.json`, "utf8"));
  const program = new Program(idl, new AnchorProvider(connection, new Wallet(buyer), { commitment: "confirmed" }));
  const pda = (...s) => PublicKey.findProgramAddressSync(s, program.programId)[0];
  const machine = pda(Buffer.from("machine"), new BN(machineId).toArrayLike(Buffer, "le", 8));
  const curve = pda(Buffer.from("curve"), machine.toBuffer());
  const coinMint = pda(Buffer.from("coin"), machine.toBuffer());
  const buyerUsdc = getAssociatedTokenAddressSync(mint, buyer.publicKey);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, buyerUsdc, buyer.publicKey, mint),
    createMintToInstruction(mint, buyerUsdc, buyer.publicKey, 6_000 * 1e6),
  );
  await connection.sendTransaction(tx, [buyer]).then((s) => connection.confirmTransaction(s, "confirmed"));
  // Purchases are capped for the first 150 slots after launch
  const { launchSlot } = await program.account.curve.fetch(curve);
  for (;;) {
    const slot = await connection.getSlot("confirmed").catch(() => 0);
    if (slot > launchSlot.toNumber() + 155) break;
    await sleep(5_000);
  }
  const sig = await program.methods
    .coinBuy(new BN(6_000 * 1e6), new BN(0))
    .accountsPartial({
      user: buyer.publicKey,
      machine,
      curve,
      coinMint,
      userCoin: getAssociatedTokenAddressSync(coinMint, buyer.publicKey),
      userUsdc: buyerUsdc,
      vault: pda(Buffer.from("prize_vault")),
      vaultToken: pda(Buffer.from("prize_vault_token")),
      usdcMint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      coinTokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const m = await program.account.machine.fetch(machine);
  const c = await program.account.curve.fetch(curve);
  console.log("curve bought out:", sig.slice(0, 16) + "…", "graduated", c.graduated, "pool USDC", m.marketUsdc.toNumber() / 1e6, "pool coins", c.poolCoins.toNumber() / 1e6);
}

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text().slice(0, 300)));
await page.setViewport({ width: 1440, height: 900 });

let signed = 0;
await page.exposeFunction("__e2eSign", (bytes) => {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
  tx.sign([kp]);
  signed++;
  return Array.from(tx.serialize());
});
await page.evaluateOnNewDocument((address, pk) => {
  const publicKey = Uint8Array.from(pk);
  const listeners = [];
  const account = { address, publicKey, chains: ["solana:devnet"], features: ["solana:signTransaction"] };
  const wallet = {
    version: "1.0.0",
    name: "E2E Test Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMxRkM3RDQiLz48L3N2Zz4=",
    chains: ["solana:devnet"],
    accounts: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          wallet.accounts = [account];
          listeners.forEach((l) => l({ accounts: wallet.accounts }));
          return { accounts: wallet.accounts };
        },
      },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          if (event === "change") listeners.push(listener);
          return () => {};
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs) =>
          Promise.all(inputs.map(async (i) => ({ signedTransaction: Uint8Array.from(await window.__e2eSign(Array.from(i.transaction))) }))),
      },
    },
  };
  const register = ({ register }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
  try {
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  } catch {}
}, kp.publicKey.toBase58(), Array.from(kp.publicKey.toBytes()));

// Clicks the first enabled button/link whose text contains `text`; inside the opening stage when it is up
const click = (text) =>
  page.evaluate((t) => {
    const root = document.querySelector("[data-stage]") ?? document;
    const el = [...root.querySelectorAll("button, a")].find((x) => x.textContent.includes(t) && !x.disabled);
    el?.click();
    return !!el;
  }, text);
const waitFor = async (fn, ms, label, ...a) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, ...a).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
    await sleep(500);
  }
};
const bodyHas = (text, ms, label = text) => waitFor((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), ms, label, text);
const stageHas = (text, ms) => waitFor((t) => document.querySelector("[data-stage]")?.innerText.toLowerCase().includes(t.toLowerCase()), ms, `stage: ${text}`, text);
const stageText = () => page.evaluate(() => document.querySelector("[data-stage]")?.innerText.replace(/\n+/g, " | "));
const step = (s) => console.log(`\n▶ ${s}`);
const until = async (cond, ms = 60_000) => {
  const t0 = Date.now();
  while (!(await cond()) && Date.now() - t0 < ms) await sleep(2500);
};

await page.goto(BASE, { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.setItem("gachastock-locale", "en"));
await page.reload({ waitUntil: "networkidle0" });

step("connect wallet");
await click("Connect wallet");
await sleep(600);
await page.evaluate(() => [...document.querySelectorAll(".wallet-adapter-modal button")].find((b) => b.textContent.includes("E2E Test Wallet"))?.click());
const short = `${kp.publicKey.toBase58().slice(0, 4)}…`;
await bodyHas(short, 15_000, "wallet connected");
await bodyHas("+ Test USDC", 20_000, "balance loaded");
console.log("connected", kp.publicKey.toBase58());

let before = await usdc();
let t0 = Date.now();
if (!INVENTORY_ONLY) {
step("faucet");
console.log("clicked faucet:", await click("+ Test USDC"));
await until(async () => (await usdc()) >= before + 500);
console.log("USDC", before, "→", await usdc());

step("open a single pack on an official machine");
before = await usdc();
await bodyHas("Open · 10 USDC", 20_000);
await click("Open · 10 USDC");
t0 = Date.now();
await stageHas("Claim USDC", 120_000);
console.log(`revealed in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, await stageText());
await page.screenshot({ path: `${SHOTS}/chain-single.png` });
await click("Claim USDC");
await stageHas("USDC delivered", 60_000);
console.log("USDC", before, "→", await usdc());
await click("Done");
await sleep(800);

step("turbo: ten packs in one draw");
before = await usdc();
await page.click("input[role=switch]");
await bodyHas("Open · 100 USDC", 5_000);
await click("Open · 100 USDC");
await stageHas("Flip all", 120_000);
await click("Flip all");
await stageHas("Claim USDC", 10_000);
await sleep(1200);
await page.screenshot({ path: `${SHOTS}/chain-ten.png` });
await click("Claim USDC");
await stageHas("USDC delivered", 60_000);
console.log("USDC", before, "→", await usdc());
await click("Done");
await sleep(800);

}

if (WITH_LAUNCH && !INVENTORY_ONLY) {
  const symbol = `E${Date.now().toString(36).slice(-5).toUpperCase()}`;
  step(`launchpad: launch machine $${symbol}`);
  await page.evaluate(() => [...document.querySelectorAll("header a")].find((a) => a.getAttribute("href") === "/launch").click());
  await bodyHas("Pack art", 15_000, "launch page");
  await page.type("input[placeholder='Mag 7 Mania']", "E2E Machine");
  await page.type("input[placeholder='MAG7']", symbol);
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/chain-launch.png`, fullPage: true });
  before = await usdc();
  console.log("clicked launch:", await click("Launch for 10 USDC"));
  await bodyHas(`$${symbol}`, 60_000, "machine page");
  await bodyHas("On the curve", 30_000, "coin on its curve");
  await bodyHas("Open · 10 USDC", 30_000, "open for pulls right away");
  const machineId = new URL(page.url()).searchParams.get("m");
  console.log("machine", machineId, "launched; USDC", before, "→", await usdc(), "(launch fee 10)");
  const coinPanel = () => page.evaluate(() => [...document.querySelectorAll("section")].find((s) => s.innerText.toLowerCase().startsWith("machine coin"))?.innerText.replace(/\n+/g, " | "));

  step("open ten packs on the new machine: every pull buys its coin for the player");
  before = await usdc();
  await page.click("input[role=switch]");
  await bodyHas("Open · 100 USDC", 5_000);
  await click("Open · 100 USDC");
  t0 = Date.now();
  await stageHas("Flip all", 120_000);
  console.log(`revealed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await click("Flip all");
  await stageHas("Claim USDC", 10_000);
  await stageHas("bought for you by this pack", 10_000);
  await sleep(1200);
  console.log(await page.evaluate(() => document.querySelector("[data-stage]").innerText.match(/Total pulled[^\n]*\n?[^\n]*\n?[^\n]*/)?.[0].replace(/\n+/g, " | ")));
  await page.screenshot({ path: `${SHOTS}/chain-rebate.png` });
  await click("Claim USDC");
  await stageHas("USDC delivered", 60_000);
  console.log("USDC", before, "→", await usdc());
  await click("Done");
  await sleep(800);
  await bodyHas("Bought for players", 20_000);
  await until(async () => !/You hold \| 0(\.00)? /.test((await coinPanel()) ?? "You hold | 0 "), 40_000);
  console.log("coin panel:", await coinPanel());

  step("creator buys a little of the coin on the curve");
  const typeAmount = async (v) => {
    await page.click("input[inputmode=decimal]", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type("input[inputmode=decimal]", String(v));
    await sleep(200);
  };
  await typeAmount(30);
  before = await usdc();
  console.log("clicked buy:", await click(`Buy $${symbol}`));
  await until(async () => (await usdc()) < before);
  console.log("USDC", before, "→", await usdc());
  await page.screenshot({ path: `${SHOTS}/chain-curve.png`, fullPage: true });

  step("a second wallet buys out the rest of the curve (from Node)");
  await buyOutCurve(machineId);
  await bodyHas("Graduated", 60_000, "coin graduated");
  await bodyHas("Pool liquidity", 20_000);
  console.log("coin panel:", await coinPanel());
  await page.screenshot({ path: `${SHOTS}/chain-graduated.png`, fullPage: true });

  step("sell the creator's coins into the pool");
  await click("Sell");
  await sleep(200);
  await click("Max");
  await sleep(300);
  before = await usdc();
  console.log("clicked sell:", await click(`Sell $${symbol}`));
  await until(async () => (await usdc()) > before);
  console.log("USDC", before, "→", await usdc(), "(coins from pulls and the curve, sold after graduation)");
  await page.screenshot({ path: `${SHOTS}/chain-coin.png`, fullPage: true });

  step("inventory: withdraw creator fees");
  await page.evaluate(() => [...document.querySelectorAll("header a")].find((a) => a.getAttribute("href") === "/inventory").click());
  await bodyHas("Machines you launched", 30_000);
  await bodyHas("1.00 USDC in creator fees", 30_000, "creator fees shown");
  before = await usdc();
  console.log("clicked withdraw:", await click("Withdraw"));
  await until(async () => (await usdc()) > before);
  console.log("USDC", before, "→", await usdc(), "(1% of 100)");
  await page.screenshot({ path: `${SHOTS}/chain-inventory.png`, fullPage: true });

  await page.evaluate(() => [...document.querySelectorAll("header a")].find((a) => a.getAttribute("href") === "/machines").click());
  await bodyHas("Coin price", 20_000);
  await sleep(1000);
  await page.screenshot({ path: `${SHOTS}/chain-machines.png`, fullPage: true });
}

if (INVENTORY_ONLY) {
  step("inventory: claim a waiting pack");
  await page.evaluate(() => [...document.querySelectorAll("header a")].find((a) => a.getAttribute("href") === "/inventory").click());
  await bodyHas("Ready to claim", 40_000);
  before = await usdc();
  console.log(await page.evaluate(() => document.querySelector("main").innerText.replace(/\n+/g, " | ").slice(0, 500)));
  console.log("clicked claim:", await click("Claim USDC"));
  await until(async () => (await usdc()) > before);
  console.log("USDC", before, "→", await usdc());
}

console.log(`\nwallet signed ${signed} transactions`);
await browser.close();
