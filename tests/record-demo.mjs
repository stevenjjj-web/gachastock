// Records a captioned walkthrough of chain mode on devnet as tests/shots/demo.webm (and .mp4
// when ffmpeg is installed): Leverage Box in the Ephemeral Rollup first, then the gacha
// machines. Uses the same injected test wallet as browser-e2e.mjs, and doubles as an
// end-to-end check of the arena page.
// Usage: node record-demo.mjs [http://localhost:3210]
// The dev server must be running with web/.env.local pointing at devnet, and a second player
// should be in the arena (npx tsx arena-bot.ts) so rounds have two sides.

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:3210";
const OUT = `${ROOT}/tests/shots`;
mkdirSync(OUT, { recursive: true });
const key = (name) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${ROOT}/.keys/${name}.json`, "utf8"))));
const kp = key("e2e");
const mint = key("usdc-mint").publicKey;
const connection = new Connection("https://api.devnet.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usdc = async () => {
  for (let attempt = 0; ; attempt++) {
    try {
      return Number((await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, kp.publicKey))).value.amount) / 1e6;
    } catch (e) {
      if (attempt >= 8) throw e;
      await sleep(3_000);
    }
  }
};

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.setViewport({ width: 1440, height: 900 });

await page.exposeFunction("__e2eSign", (bytes) => {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
  tx.sign([kp]);
  return Array.from(tx.serialize());
});
await page.evaluateOnNewDocument((address, pk) => {
  const publicKey = Uint8Array.from(pk);
  const listeners = [];
  const account = { address, publicKey, chains: ["solana:devnet"], features: ["solana:signTransaction"] };
  const wallet = {
    version: "1.0.0",
    name: "Demo Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiNGRkM3MkMiLz48L3N2Zz4=",
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

  // Caption bar and click highlight for the recording
  window.__caption = (text) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText =
        "position:fixed;left:50%;bottom:56px;transform:translateX(-50%);z-index:99999;max-width:980px;padding:14px 22px;border-radius:14px;" +
        "background:rgba(8,10,8,.92);border:1px solid #ffc72c;color:#f4f3ea;font:600 20px/1.35 'Space Grotesk',system-ui,sans-serif;text-align:center;" +
        "box-shadow:0 12px 40px rgba(0,0,0,.6);pointer-events:none;transition:opacity .25s";
      document.documentElement.appendChild(el);
    }
    el.style.opacity = text ? "1" : "0";
    if (text) el.textContent = text;
  };
  window.__flash = (el) => {
    const r = el.getBoundingClientRect();
    const ring = document.createElement("div");
    ring.style.cssText = `position:fixed;left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px;border:3px solid #ffc72c;border-radius:14px;z-index:99998;pointer-events:none;transition:opacity .5s`;
    document.documentElement.appendChild(ring);
    setTimeout(() => (ring.style.opacity = "0"), 350);
    setTimeout(() => ring.remove(), 900);
  };
}, kp.publicKey.toBase58(), Array.from(kp.publicKey.toBytes()));

const caption = async (text, hold = 0) => {
  await page.evaluate((t) => window.__caption(t), text);
  if (hold) await sleep(hold);
};
// Highlights, then clicks, the first enabled button/link whose text contains `text`
const click = async (text) => {
  const found = await page.evaluate((t) => {
    const root = document.querySelector("[data-stage]") ?? document;
    const el = [...root.querySelectorAll("button, a")].find((x) => x.textContent.includes(t) && !x.disabled);
    if (el) window.__flash(el);
    return !!el;
  }, text);
  if (!found) throw new Error(`no button: ${text}`);
  await sleep(450);
  await page.evaluate((t) => {
    const root = document.querySelector("[data-stage]") ?? document;
    [...root.querySelectorAll("button, a")].find((x) => x.textContent.includes(t) && !x.disabled)?.click();
  }, text);
};
const waitFor = async (fn, ms, label, ...a) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, ...a).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
    await sleep(400);
  }
};
const bodyHas = (text, ms, label = text) => waitFor((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), ms, label, text);
const stageHas = (text, ms) => waitFor((t) => document.querySelector("[data-stage]")?.innerText.toLowerCase().includes(t.toLowerCase()), ms, `stage: ${text}`, text);
const nav = (href) => page.evaluate((h) => [...document.querySelectorAll("header a")].find((a) => a.getAttribute("href") === h).click(), href);
const until = async (cond, ms = 60_000) => {
  const t0 = Date.now();
  while (!(await cond()) && Date.now() - t0 < ms) await sleep(2_000);
};

// The arena polls the rollup continuously, so the network never goes idle
await page.goto(`${BASE}/arena`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => localStorage.setItem("gachastock-locale", "en"));
await page.reload({ waitUntil: "domcontentloaded" });
// The dev-mode indicator does not belong in the recording
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await waitFor(() => /\$\d/.test(document.querySelector("[data-price]")?.textContent ?? ""), 30_000, "live price");

const recorder = await page.screencast({ path: `${OUT}/demo.webm` });
const step = (s) => console.log(`▶ ${s}`);
const text = (sel) => page.evaluate((q) => document.querySelector(q)?.innerText.replace(/\n+/g, " | ") ?? "", sel);
const phase = () => text("[data-phase]");
const enabled = (label) => page.evaluate((t) => [...document.querySelectorAll("button")].some((b) => b.textContent.includes(t) && !b.disabled), label);

step("intro");
await caption("Leverage Box: open a box, get a random leveraged position, settle against other players in under a minute.", 4_500);
await caption("The price is live: MagicBlock's Pyth Lazer oracle, read inside an Ephemeral Rollup.", 4_000);

step("connect");
await caption("Connect a wallet");
await click("Connect wallet");
await sleep(900);
await page.evaluate(() => [...document.querySelectorAll(".wallet-adapter-modal button")].find((b) => b.textContent.includes("Demo Wallet"))?.click());
await bodyHas("+ Test USDC", 25_000, "balance loaded");
await sleep(1_500);
if ((await usdc()) < 150) {
  const before = await usdc();
  await caption("Grab some devnet test USDC");
  await click("+ Test USDC");
  await until(async () => (await usdc()) > before);
  await sleep(2_000);
}

step("deposit");
await caption("One approval on Solana: deposit USDC and delegate your account to the rollup");
await bodyHas("Deposit 100 USDC", 30_000);
let before = await usdc();
await click("Deposit 100 USDC");
await waitFor(() => document.querySelector("[data-balance]")?.textContent.includes("100.00"), 60_000, "arena balance");
console.log("  deposited; wallet USDC", before, "→", await usdc());
await sleep(1_200);

step("open boxes");
await caption("From here it is instant and free: a session key signs, no wallet pop-ups, no fees");
await waitFor(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Open a box") && !b.disabled), 90_000, "boxes open");
let opened = 0;
for (let i = 0; i < 4; i++) {
  if (!(await enabled("Open a box"))) break;
  await click("Open a box");
  const got = await waitFor(() => document.querySelector("[data-reveal]")?.innerText.replace(/\n+/g, " ") ?? (document.body.innerText.includes("round locked first") ? "refunded" : null), 20_000, "draw");
  console.log("  box:", got);
  if (got === "refunded") break;
  opened++;
  if (i === 0) await caption("MagicBlock VRF draws each box in the rollup: a random side and leverage, in milliseconds");
  await sleep(1_500);
  await page.evaluate(() => document.querySelector("[data-reveal]")?.click());
  await sleep(500);
}
if (!opened) throw new Error("no box was opened");
console.log("  tickets:", await text("[data-tickets]"));

step("live round");
await caption("The lighter side is more likely, so longs and shorts stay balanced without a market maker", 4_000);
await waitFor(() => /settles|settling/i.test(document.querySelector("[data-phase]")?.textContent ?? ""), 60_000, "round live");
await caption("The round locks at the oracle price. Every box shows what it would pay right now.", 6_000);
console.log("  live:", await phase(), "|", await text("[data-tickets]"));
await caption("Wrong side: you lose stake × leverage × move, at most your stake. Right side: you split what the losers lost.", 8_000);
await caption("Winners only take what losers lose. The program is never the counterparty.", 6_000);
await waitFor(() => !!document.querySelector("[data-results]"), 90_000, "round settled");
await caption("Settled at the oracle price in one instruction, and credited automatically");
await sleep(4_500);
console.log("  results:", await text("[data-results]"), "| balance", await text("[data-balance]"));

step("cash out");
await caption("Cash out: the account is committed back to Solana and the USDC returns to the wallet");
before = await usdc();
await waitFor(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Cash out") && !b.disabled), 120_000, "cash out available");
await click("Cash out");
await until(async () => (await usdc()) > before, 120_000);
console.log("  cashed out; wallet USDC", before, "→", await usdc());
await sleep(2_000);

step("gacha");
await caption("The same app has gacha machines for tokenized stocks, drawn by MagicBlock VRF on Solana");
await nav("/");
await bodyHas("Open · 10 USDC", 30_000);
await sleep(1_200);
await page.click("input[role=switch]");
await bodyHas("Open · 100 USDC", 5_000);
await click("Open · 100 USDC");
await stageHas("Flip all", 120_000);
await sleep(600);
await click("Flip all");
await stageHas("Claim USDC", 10_000);
await caption("10 USDC a pack, 7.50 always back as stock, one shared prize pool, and a coin you earn by playing", 5_000);
await click("Claim USDC");
await stageHas("USDC delivered", 60_000);
await sleep(800);
await click("Done");

step("outro");
await caption("GachaStock. Two programs, MagicBlock VRF, Ephemeral Rollups, Pyth Lazer. Open source. gachastock-bice.vercel.app", 5_500);
await caption("");
await sleep(400);

await recorder.stop();
await browser.close();
console.log("saved", `${OUT}/demo.webm`);
try {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${OUT}/demo.webm`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-movflags", "+faststart", `${OUT}/demo.mp4`]);
  console.log("saved", `${OUT}/demo.mp4`);
} catch (e) {
  console.log("ffmpeg conversion skipped:", e.message);
}
