// Records the GachaStock launch film: a 1920×1080 walkthrough of all three ways to play (stock
// blind boxes, stock memes and Leverage Box) cut like a product launch. The app runs in demo mode;
// Leverage Box reads its live price from MagicBlock's Ephemeral Rollup.
//
// Two passes, so the film is smooth on any machine:
//   1. capture: drives the real app in a 1440×900 browser, records every frame it paints with its
//      timestamp, and logs a timeline of what the camera, cursor, captions and cards should do;
//   2. render:  replays that timeline on film/stage.html frame by frame, 30 fps, in parallel
//      workers, then adds the generated score (film/score.mjs).
// Writes tests/shots/launch.mp4.
//
// Usage: node record-launch.mjs [http://localhost:3210] [--render-only]
// The app must be running in demo mode at that address, ideally a production build:
//   cd web && npm run build && npx next start -p 3210

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { writeScore } from "./film/score.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith("http")) ?? "http://localhost:3210";
const OUT = `${ROOT}/tests/shots`;
const FRAMES = `${OUT}/launch-frames`;
const TIMELINE = `${OUT}/launch-timeline.json`;
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const chrome =
  process.env.CHROME_PATH ??
  ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p));
if (!chrome) throw new Error("no Chromium found; set CHROME_PATH");
const launch = (viewport) =>
  puppeteer.launch({ executablePath: chrome, headless: "new", defaultViewport: viewport, args: ["--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=1"] });

// Window geometry on the stage: the app sits under a 40 px title bar
const W = 1440, H = 940, TB = 40, SW = 1920, SH = 1080;

if (!args.includes("--render-only")) await capture();
await render();

// ── Pass 1: capture ──────────────────────────────────────────────────────────────────────────
async function capture() {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const browser = await launch({ width: 1440, height: 900 });
  const [page] = await browser.pages();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && console.log("console:", m.text().slice(0, 200)));

  // A fresh demo: default machines and balances, English. Then warm every page up.
  await page.goto(BASE, { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("gachastock-locale", "en");
  });
  for (const path of ["/launch", "/machines", "/arena", "/"]) {
    await page.goto(BASE + path, { waitUntil: "load" });
    await sleep(700);
  }

  const waitApp = async (fn, ms, label, ...a) => {
    const t0 = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, ...a).catch(() => null);
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
      await sleep(120);
    }
  };
  const appHas = (text, ms = 30_000) => waitApp((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), ms, text, text);
  const stageHas = (text, ms = 30_000) =>
    waitApp((t) => document.querySelector("[data-stage]")?.innerText.toLowerCase().includes(t.toLowerCase()), ms, `stage: ${text}`, text);
  const appText = (sel) => page.evaluate((q) => document.querySelector(q)?.innerText.replace(/\n+/g, " | ") ?? "", sel);
  await appHas("Open · 10 USDC");

  // Every frame the app paints, with its timestamp
  const frames = [];
  const cdp = await page.createCDPSession();
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `f${String(frames.length).padStart(5, "0")}.jpg`;
    frames.push({ t: metadata.timestamp, file });
    writeFileSync(`${FRAMES}/${file}`, Buffer.from(data, "base64"));
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 94, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
  await sleep(300);

  // ── Director: logs timeline events and waits as long as each one takes on screen ──
  const T0 = Date.now() / 1_000;
  const events = [];
  const now = () => Date.now() / 1_000 - T0;
  const ev = (kind, data = {}) => events.push({ t: now(), kind, ...data });
  const mark = (name) => {
    ev("mark", { name });
    console.log(`▶ ${name}  ${now().toFixed(1)}s`);
  };
  let lastPath = "";
  const pathTimer = setInterval(() => {
    const u = new URL(page.url());
    if (u.pathname + u.search !== lastPath) {
      lastPath = u.pathname + u.search;
      ev("path", { path: lastPath });
    }
  }, 150);

  // Camera: the window point (fx, fy) lands on screen at (cx, cy), scaled by s. Zoomed out, the
  // whole window stays on screen; zoomed in, it covers the screen.
  const cam = { s: 0.84, fx: W / 2, fy: H / 2, cx: SW / 2, cy: SH / 2 + 18 };
  const fit = (f, len, center, screen, s) => {
    if (len * s <= screen) {
      const lo = len - (screen - center) / s, hi = center / s;
      return Math.min(Math.max(f, lo), hi);
    }
    return Math.min(Math.max(f, center / s), len - (screen - center) / s);
  };
  const camNow = () => {
    const fx = fit(cam.fx, W, cam.cx, SW, cam.s), fy = fit(cam.fy, H, cam.cy, SH, cam.s);
    return { tx: cam.cx - fx * cam.s, ty: cam.cy - fy * cam.s, s: cam.s };
  };
  const toScreen = (x, y) => {
    const c = camNow();
    return [c.tx + x * c.s, c.ty + y * c.s];
  };

  /** The element matching selector `q`, or the shortest visible enabled button/link/label containing text `q`; its centre in window coordinates. */
  const rect = (q) =>
    page.evaluate(
      (q, TB) => {
        let el = null;
        if (/^[#.[]|^(input|button|a|label|section|main|div|ul|li|h1|h2|p|span)\b/.test(q)) el = document.querySelector(q);
        else {
          const root = document.querySelector("[data-stage]") ?? document;
          el =
            [...root.querySelectorAll("button, a, label, [role=radio], [role=switch]")]
              .filter((x) => x.textContent.replace(/\s+/g, " ").includes(q) && !x.disabled && x.getClientRects().length)
              .sort((a, b) => a.textContent.length - b.textContent.length)[0] ?? null;
        }
        if (!el || !el.getClientRects().length) return null;
        window.__target = el;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 + TB };
      },
      q,
      TB,
    );

  const camTo = async ({ s, focus, x, y, cx, cy, dx = 0, dy = 0, ms = 1500, wait = true } = {}) => {
    if (s !== undefined) cam.s = s;
    if (focus) {
      const b = await rect(focus);
      if (b) {
        cam.fx = b.x + dx;
        cam.fy = b.y + dy;
      }
    }
    if (x !== undefined) cam.fx = x;
    if (y !== undefined) cam.fy = y;
    if (cx !== undefined) cam.cx = cx;
    if (cy !== undefined) cam.cy = cy;
    ev("cam", { to: camNow(), ms });
    if (wait) await sleep(ms);
  };
  const wide = (ms = 1500, wait = true) => camTo({ s: 0.84, x: W / 2, y: H / 2, cx: SW / 2, cy: SH / 2 + 18, ms, wait });

  let cursor = { x: W / 2, y: 1300 };
  const cursorShow = async (on = true) => {
    ev("cursorShow", { on });
    await sleep(300);
  };
  const cursorTo = async (q, { ms } = {}) => {
    const b = await rect(q);
    if (!b) throw new Error(`cursor target not found: ${q}`);
    const [ax, ay] = toScreen(cursor.x, cursor.y), [bx, by] = toScreen(b.x, b.y);
    const dur = ms ?? Math.min(1100, 420 + Math.hypot(bx - ax, by - ay) * 0.45);
    ev("cursor", { x: b.x, y: b.y, ms: dur });
    cursor = b;
    await sleep(dur + 60);
  };
  const click = async (q, opts = {}) => {
    await cursorTo(q, opts);
    ev("click");
    await sleep(130);
    const press = () =>
      page.evaluate(() => {
        const el = window.__target;
        if (!el?.isConnected) return false;
        el.click();
        return true;
      });
    // React may have replaced the node while the cursor travelled
    if (!(await press()) && !((await rect(q)) && (await press()))) throw new Error(`click target went away: ${q}`);
    await sleep(200);
  };
  const type = async (selector, text) => {
    await page.focus(selector);
    await page.keyboard.type(text, { delay: 95 });
  };
  /** Smoothly scrolls the app to `y`. */
  const scrollTo = (y, ms = 1100) =>
    page.evaluate(
      (y, ms) =>
        new Promise((resolve) => {
          const el = document.scrollingElement;
          const from = el.scrollTop;
          const t0 = performance.now();
          const step = (t) => {
            const k = Math.min(1, (t - t0) / ms);
            const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
            el.scrollTop = from + (y - from) * e;
            if (k < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        }),
      y,
      ms,
    );

  let captionOn = false;
  const caption = async (text, { hold = 0 } = {}) => {
    ev("caption", { text });
    await sleep((text ? (captionOn ? 760 : 500) : 450) + hold);
    captionOn = !!text;
  };
  const label = async (n, text) => {
    ev("label", { n, text });
    await sleep(text ? 600 : 400);
  };
  const footnote = (text) => ev("footnote", { text });
  const side = async (title, lines = [], gap = 1200) => {
    ev("side", { title, lines, gap });
    await sleep(title ? 750 + gap * (lines.length - 1) + 400 : 550);
  };
  let cardUp = false;
  const card = async (html, { hold = 0 } = {}) => {
    ev("card", { html });
    await sleep((cardUp ? 450 : 30) + 900 + hold);
    cardUp = true;
  };
  const cardOut = async (ms = 950) => {
    ev("cardOut");
    cardUp = false;
    await sleep(ms);
  };
  const showWindow = async () => {
    ev("window", { on: true });
    await sleep(1100);
  };
  /** Full navigation, done while a card covers the window */
  const load = async (path) => {
    await page.goto(BASE + path, { waitUntil: "load" });
    cam.s = 0.84;
    Object.assign(cam, { fx: W / 2, fy: H / 2, cx: SW / 2, cy: SH / 2 + 18 });
    ev("cam", { to: camNow(), ms: 0 });
  };

  // ── Copy ──
  const BULL = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
  <path d="M26 40c-12-4-17-16-13-27 9 3 19 10 23 20z" fill="#FFF6E0" stroke="#e8d9b5" stroke-width="1.5"/><path d="M94 40c12-4 17-16 13-27-9 3-19 10-23 20z" fill="#FFF6E0" stroke="#e8d9b5" stroke-width="1.5"/>
  <ellipse cx="14" cy="58" rx="13" ry="9" transform="rotate(-18 14 58)" fill="#FFB237"/><ellipse cx="106" cy="58" rx="13" ry="9" transform="rotate(18 106 58)" fill="#FFB237"/>
  <ellipse cx="14" cy="58" rx="7" ry="4.5" transform="rotate(-18 14 58)" fill="#FF8AC8"/><ellipse cx="106" cy="58" rx="7" ry="4.5" transform="rotate(18 106 58)" fill="#FF8AC8"/>
  <ellipse cx="60" cy="66" rx="46" ry="42" fill="#FFC94D"/><path d="M48 27c3-8 9-11 12-11s9 3 12 11c-6 3-18 3-24 0z" fill="#FFB237"/>
  <ellipse cx="60" cy="84" rx="27" ry="18" fill="#FFE9B8"/><ellipse cx="51" cy="84" rx="3.6" ry="5" fill="#E58A2B"/><ellipse cx="69" cy="84" rx="3.6" ry="5" fill="#E58A2B"/>
  <circle cx="40" cy="60" r="7.5" fill="#280D5F"/><circle cx="80" cy="60" r="7.5" fill="#280D5F"/><circle cx="42.5" cy="57.5" r="2.6" fill="#fff"/><circle cx="82.5" cy="57.5" r="2.6" fill="#fff"/>
  <ellipse cx="26" cy="74" rx="7" ry="4.5" fill="#FF8AC8" opacity=".7"/><ellipse cx="94" cy="74" rx="7" ry="4.5" fill="#FF8AC8" opacity=".7"/></svg>`;
  const chapter = (n, title, lede, extra = "") =>
    card(
      `<div class="stack" style="gap:26px">
        ${extra}
        <p class="chapno rise" data-d="150">${n}</p>
        <h1 class="chapter rise" data-d="350">${title}</h1>
        <p class="lede rise" data-d="850" style="max-width:1220px">${lede}</p>
      </div>`,
      { hold: 2700 },
    );
  const CLOSE = 1.7;

  // ── Cold open and title ──
  mark("cold open");
  await card(
    `<div class="stack" style="gap:40px">
      <p class="eyebrow rise" data-d="300">MagicBlock Solana Blitz<span class="sep">·</span>v9</p>
      <h1 class="display"><span class="rise" data-d="1000" style="display:inline-block">What if the stock market</span><br>
        <span class="rise" data-d="1900" style="display:inline-block"><em>came in a box?</em></span></h1>
    </div>`,
    { hold: 2900 },
  );
  ev("hold", { secs: 0.8 });
  mark("title");
  await card(
    `<div class="stack" style="gap:38px">
      <p class="eyebrow rise" data-d="150">Introducing</p>
      <div class="wordmark rise" data-d="400">${BULL(150)}<span>GachaStock</span></div>
      <p class="lede rise" data-d="1100">Three ways to play the stock market with 10 USDC, <b>settled between players</b>, never against a house.</p>
      <div class="pills rise" data-d="1800">
        <span class="pill"><i style="background:#FF9D00"></i>Stock Blind Boxes</span>
        <span class="pill"><i style="background:#D82A85"></i>Stock Memes</span>
        <span class="pill"><i style="background:#7645D9"></i>Leverage Box</span>
      </div>
      <p class="fine rise" data-d="2500">Built on Solana and MagicBlock</p>
    </div>`,
    { hold: 3400 },
  );

  // ── 01 Stock Blind Boxes ──
  mark("01 stock blind boxes");
  await chapter("01", "Stock Blind Boxes", "Rip a pack of tokenized US stocks. 10 USDC in, <b>7.50 back no matter what</b>, and a shot at one shared jackpot.");
  await cardOut(350);
  await showWindow();
  label("01", "Stock Blind Boxes");
  footnote("Recorded in demo mode · same rules as the program · no real funds");
  await caption("Pick a machine. Each one has its own basket of tokenized stocks.");
  await cursorShow();
  await click("Tech Machine");
  await sleep(500);
  await camTo({ s: CLOSE, x: 470, y: 700, ms: 1600 });
  await caption("Turbo opens ten packs with a single random draw.");
  await click("input[role=switch] + span");
  await sleep(500);
  await caption("Every draw comes from MagicBlock VRF. Nobody can re-roll it, not even us.");
  await click("Open · 100 USDC");
  await camTo({ s: 1, x: W / 2, y: H / 2, ms: 1300, wait: false });
  await stageHas("Flip all", 60_000);
  await sleep(600);
  await caption("Seven tiers, from the 7.50 floor up to half the shared prize pool.");
  await click("Flip all");
  await sleep(2600);
  console.log("  pulls:", (await appText("[data-stage]")).slice(0, 220));
  await caption("Claim as tokenized stock in one swap, or straight to USDC.");
  await click("Claim USDC");
  await stageHas("USDC delivered", 20_000);
  await sleep(1300);
  await click("Done");
  await cursorShow(false);
  await caption(null);
  label(null);

  // ── 02 Stock Memes ──
  mark("02 stock memes");
  ev("card", {
    html: `<div class="stack" style="gap:26px">
      <p class="chapno rise" data-d="150">02</p>
      <h1 class="chapter rise" data-d="350">Stock Memes</h1>
      <p class="lede rise" data-d="850" style="max-width:1220px">Anyone can launch a meme machine on a basket of stocks. Its coin is <b>bought for every player who pulls</b>.</p>
    </div>`,
  });
  cardUp = true;
  const cardEnd = Date.now() + 450 + 900 + 2700;
  await sleep(1300);
  await load("/launch");
  await appHas("Launch for 10 USDC");
  await sleep(Math.max(0, cardEnd - Date.now()));
  await cardOut(500);
  label("02", "Stock Memes");
  await caption("Name it, pick the art and the stocks.");
  await camTo({ s: CLOSE, x: 470, y: 340, ms: 1500, wait: false });
  await cursorShow();
  await sleep(700);
  await click("input[placeholder='Mag 7 Mania']");
  await type("input[placeholder='Mag 7 Mania']", "Stonks Only");
  await click("input[placeholder='MAG7']");
  await type("input[placeholder='MAG7']", "STONK");
  await click("[aria-label=Lime]");
  for (const s of ["AAPLx", "COINx", "HOODx", "PLTRx", "MSTRx"]) await click(s, { ms: 520 });
  await sleep(300);
  await camTo({ s: 1, x: W / 2, y: H / 2, ms: 1300 });
  await caption("One transaction and it is live, playing for the shared prize pool.");
  await click("Launch for 10 USDC");
  await appHas("Each pack also buys you about", 20_000);
  await wide(900);
  await caption("3% of every pull buys the machine's coin for the player who pulled.");
  await camTo({ s: CLOSE, x: 470, y: 760, ms: 1500 });
  await click("Open · 10 USDC");
  await camTo({ s: 1, x: W / 2, y: H / 2, ms: 1300, wait: false });
  await stageHas("Claim USDC", 60_000);
  await sleep(1500);
  await camTo({ s: CLOSE, focus: "[data-coins]", dy: -90, ms: 1300 });
  console.log("  coins:", await appText("[data-coins]"));
  await sleep(1500);
  await click("Claim USDC");
  await stageHas("USDC delivered", 20_000);
  await sleep(700);
  await camTo({ s: 1, x: W / 2, y: H / 2, ms: 1000 });
  await click("Done");
  await sleep(400);
  await caption("The coin starts on a bonding curve. At $5,000 it graduates into a trading pool.");
  await Promise.all([scrollTo(420, 1300), camTo({ s: CLOSE, x: 1062, y: 560, ms: 1500 })]);
  await click("$50");
  await sleep(300);
  await caption("Trade it any time. Play the machine, own a piece of it.");
  await click("Buy $STONK");
  await sleep(2200);
  await camTo({ s: 0.84, x: W / 2, y: H / 2, ms: 1200, wait: false });
  await scrollTo(0, 900);
  await sleep(300);
  await click("Machines");
  await appHas("Volume", 15_000);
  await sleep(400);
  await caption("Every machine, ranked by volume, plays for one shared prize pool.");
  await camTo({ s: 1, x: W / 2, y: 480, ms: 1700 });
  await sleep(1500);
  await cursorShow(false);
  await caption(null);
  label(null);

  // ── 03 Leverage Box ──
  mark("03 leverage box");
  ev("card", {
    html: `<div class="stack" style="gap:26px">
      <p class="rise" data-d="0"><span class="newbadge"><i></i>New for Solana Blitz</span></p>
      <p class="chapno rise" data-d="150">03</p>
      <h1 class="chapter rise" data-d="350">Leverage Box</h1>
      <p class="lede rise" data-d="850" style="max-width:1220px">Open a box, get a random long or short at up to <b>10,000×</b>, and settle against the other players in 45 seconds.</p>
    </div>`,
  });
  cardUp = true;
  const card3End = Date.now() + 450 + 900 + 3000;
  await sleep(1300);
  await load("/arena");
  await waitApp(() => /\$\d/.test(document.querySelector("[data-price]")?.textContent ?? ""), 30_000, "live price");
  await sleep(Math.max(0, card3End - Date.now()));
  await cardOut(500);
  label("03", "Leverage Box");
  footnote("Recorded in demo mode · live oracle price · simulated players");
  await camTo({ s: CLOSE, focus: "[data-price]", dx: 170, dy: 40, ms: 1600 });
  await caption("Each round runs on a live Pyth Lazer price.", { hold: 1700 });
  await camTo({ s: CLOSE, x: 1050, y: 330, ms: 1400 });
  await caption("Deposit once, with a single wallet approval.");
  await cursorShow();
  await click("Deposit 100 USDC");
  await waitApp(() => document.querySelector("[data-balance]")?.textContent.includes("100.00"), 20_000, "arena balance");
  await sleep(400);
  await caption("After that, opening a box is instant and free, with no wallet pop-ups.");
  let opened = 0;
  for (let i = 0; i < 4; i++) {
    const ok = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Open a box") && !b.disabled));
    if (!ok) break;
    await click("Open a box");
    const got = await waitApp(
      () => document.querySelector("[data-reveal]")?.innerText.replace(/\n+/g, " ") ?? (document.body.innerText.includes("round locked first") ? "refunded" : null),
      10_000,
      "draw",
    );
    console.log("  box:", got);
    if (got === "refunded") break;
    opened++;
    if (i === 0) await caption("MagicBlock VRF draws each box's side and leverage.");
    await sleep(1000);
    await page.evaluate(() => document.querySelector("[data-reveal]")?.click());
    await sleep(350);
  }
  if (!opened) throw new Error("no box was opened");
  await cursorShow(false);
  await camTo({ s: CLOSE, x: 470, y: 560, ms: 1400 });
  await caption("The lighter side is more likely, so longs and shorts balance themselves.");
  await waitApp(() => /settles|settling/i.test(document.querySelector("[data-phase]")?.textContent ?? ""), 30_000, "round live");
  mark("round live");
  await caption(null);
  label(null);
  footnote(null);
  await camTo({ s: 0.66, x: W / 2, y: H / 2, cx: 600, cy: 560, ms: 1600 });
  await side(
    "How a round <em>settles</em>",
    [
      "Locks at the oracle price and runs for <b>30 seconds</b>.",
      "The wrong side loses <b>stake × leverage × move</b>, never more than the stake.",
      "The right side splits exactly what the losers lost.",
      "The program is never the counterparty. It keeps 10% of winnings.",
      "Settlement is one O(1) instruction, however many boxes.",
    ],
    2500,
  );
  await sleep(1400);
  await side(null);
  await camTo({ s: CLOSE, x: 1050, y: 640, cx: SW / 2, cy: SH / 2, ms: 1600 });
  label("03", "Leverage Box");
  await caption("Every box shows what it would pay if the round ended right now.");
  console.log("  live:", await appText("[data-phase]"), "|", await appText("[data-tickets]"));
  await waitApp(() => !!document.querySelector("[data-results]"), 60_000, "round settled");
  mark("settled");
  await sleep(300);
  await camTo({ s: CLOSE, focus: "[data-results]", ms: 1200 });
  await caption("Settled at the oracle price and credited automatically.", { hold: 1500 });
  console.log("  results:", await appText("[data-results]"), "| balance", await appText("[data-balance]"));
  await camTo({ s: CLOSE, x: 1050, y: 330, ms: 1300 });
  await caption("Cash out between rounds and the USDC goes back to your wallet.");
  await cursorShow();
  await waitApp(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Cash out") && !b.disabled), 20_000, "cash out");
  await click("Cash out");
  await waitApp(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Deposit 100 USDC")), 20_000, "cashed out");
  await sleep(1000);
  await cursorShow(false);
  await caption(null);
  label(null);
  await wide(1000);

  // ── Under the hood, proof, outro ──
  mark("under the hood");
  await card(
    `<div class="stack" style="gap:48px">
      <p class="eyebrow rise" data-d="100">Under the hood</p>
      <div class="arch">
        <div class="lane rise" data-d="300">
          <h4>Solana</h4><p class="sub">Base layer</p>
          <ul><li><i></i>USDC vault, never leaves Solana</li><li><i></i>Deposit and delegate</li><li><i></i>Withdraw with the owner's key</li><li><i></i>Gacha draws by MagicBlock VRF</li></ul>
        </div>
        <div class="wires rise" data-d="700">
          <div class="wire">delegate<svg width="180" height="20"><path data-draw d="M4 10 H168 M158 3 L170 10 L158 17" fill="none" stroke="#c8643b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div class="wire"><svg width="180" height="20"><path data-draw d="M176 10 H12 M22 3 L10 10 L22 17" fill="none" stroke="#6f6b61" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>commit</div>
        </div>
        <div class="lane er rise" data-d="1000">
          <h4>Ephemeral Rollup</h4><p class="sub">MagicBlock · Leverage Box only</p>
          <ul><li><i></i>Boxes signed by a session key</li><li><i></i>A VRF draw for every box</li><li><i></i>Pyth Lazer price feeds</li><li><i></i>O(1) settlement and claims</li></ul>
        </div>
      </div>
      <div class="stats rise" data-d="1700">
        <div class="stat"><b>0</b><span>fees or pop-ups per box</span></div>
        <div class="stat"><b>45 s</b><span>from box to settlement</span></div>
        <div class="stat"><b>20,000</b><span>random rounds, solvency checked</span></div>
        <div class="stat"><b>2</b><span>Anchor programs, open source</span></div>
      </div>
    </div>`,
    { hold: 5000 },
  );
  mark("proof");
  await card(
    `<div class="stack" style="gap:44px">
      <p class="eyebrow rise" data-d="100">Live on Solana devnet</p>
      <div class="proof rise" data-d="400">
        <span class="k">Leverage Box</span><span class="mono">7YqLqC9wArnHb7aKcCRxkFMbKYE2gqQnExXtMyBdZ5Rv</span>
        <span class="k">Gacha machines</span><span class="mono">7VAfdZyRRWCvLdPUpqYbeuSsvtQW4cp2PeVQvkAtBHHv</span>
        <span class="k">A box in the rollup</span><span class="mono">4aUdsh8XenvfKH5SymyL8mfVtVHvvynoWR5A…</span>
      </div>
      <p class="fine rise" data-d="1000">Every step from deposit to withdrawal is linked to the explorer in the README.</p>
    </div>`,
    { hold: 3300 },
  );
  mark("outro");
  await card(
    `<div class="stack" style="gap:34px">
      <div class="wordmark rise" data-d="200" style="font-size:132px">${BULL(132)}<span>GachaStock</span></div>
      <p class="lede rise" data-d="800" style="color:var(--ink)">Stock blind boxes. Stock memes. <em style="font-family:var(--serif);font-size:38px;color:var(--clay)">Leverage boxes.</em></p>
      <div class="pills rise" data-d="1400">
        <span class="pill">gachastock-bice.vercel.app</span>
        <span class="pill">github.com/stevenjjj-web/gachastock</span>
      </div>
      <p class="fine rise" data-d="2000">Built on MagicBlock · Devnet only, unaudited, test USDC</p>
    </div>`,
    { hold: 3600 },
  );
  ev("hold", { secs: 0.8 });
  mark("end");
  await sleep(500);
  const duration = now();

  clearInterval(pathTimer);
  await cdp.send("Page.stopScreencast");
  await browser.close();
  writeFileSync(TIMELINE, JSON.stringify({ duration, events, frames: frames.map((f) => ({ t: f.t - T0, file: f.file })) }));
  console.log(`captured ${frames.length} app frames, ${events.length} events, ${duration.toFixed(1)} s`);
}

// ── Pass 2: render ───────────────────────────────────────────────────────────────────────────
async function render() {
  const { duration, events, frames } = JSON.parse(readFileSync(TIMELINE, "utf8"));
  const STAGE = readFileSync(new URL("./film/stage.html", import.meta.url), "utf8");
  // A hold freezes the timeline on a still frame while the film keeps running
  const holds = events.filter((e) => e.kind === "hold").sort((a, b) => a.t - b.t);
  const length = duration + holds.reduce((sum, h) => sum + h.secs, 0);
  const at = (t) => {
    let shift = 0;
    for (const h of holds) {
      if (t < h.t + shift) break;
      if (t < h.t + shift + h.secs) return h.t;
      shift += h.secs;
    }
    return t - shift;
  };
  const filmTime = (t) => t + holds.filter((h) => h.t < t).reduce((sum, h) => sum + h.secs, 0);
  const total = Math.ceil(length * FPS);
  const workers = Math.max(1, Math.min(3, cpus().length - 1));
  const per = Math.ceil(total / workers);
  const frameAt = (t) => {
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  console.log(`rendering ${total} frames with ${workers} workers`);
  const t0 = Date.now();

  const segment = async (k) => {
    const from = k * per, to = Math.min(total, from + per);
    const out = `${OUT}/launch-seg${k}.mp4`;
    const browser = await launch({ width: SW, height: SH });
    const [page] = await browser.pages();
    page.on("pageerror", (e) => console.log("PAGEERROR (stage)", e.message));
    await page.setRequestInterception(true);
    page.on("request", (req) =>
      req.url() === `${BASE}/__film` ? req.respond({ status: 200, contentType: "text/html; charset=utf-8", body: STAGE }) : req.continue(),
    );
    await page.goto(`${BASE}/__film`, { waitUntil: "load" });
    await page.evaluate(async (events) => {
      window.film.setTimeline(events);
      await Promise.all(
        ["400 20px Newsreader", "italic 400 20px Newsreader", "500 20px Newsreader", "400 20px Inter", "500 20px Inter", "600 20px Inter", "500 20px 'JetBrains Mono'"].map((f) => document.fonts.load(f)),
      );
      await document.fonts.ready;
    }, events);
    const cdp = await page.createCDPSession();
    const ff = spawn(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", out],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    let shown = -1;
    for (let i = from; i < to; i++) {
      const t = at(i / FPS);
      const fi = frameAt(t);
      if (fi !== shown) {
        const src = `data:image/jpeg;base64,${readFileSync(`${FRAMES}/${frames[fi].file}`).toString("base64")}`;
        await page.evaluate((s) => window.film.setFrame(s), src);
        shown = fi;
      }
      await page.evaluate((t) => window.film.render(t), t);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 95, optimizeForSpeed: true });
      if (!ff.stdin.write(Buffer.from(data, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
      if (k === 0 && (i - from) % 300 === 0) console.log(`  worker 0: ${i - from}/${to - from} (${((Date.now() - t0) / 1_000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
    await browser.close();
    return out;
  };
  const segs = await Promise.all(Array.from({ length: workers }, (_, k) => segment(k)));
  console.log(`rendered in ${((Date.now() - t0) / 1_000).toFixed(0)} s`);

  const list = `${OUT}/launch-segs.txt`;
  writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n"));
  const marks = events.filter((e) => e.kind === "mark").map((e) => ({ name: e.name, t: filmTime(e.t) }));
  const score = `${OUT}/launch-score.wav`;
  writeScore(score, length, marks);
  const final = `${OUT}/launch.mp4`;
  const fadeOut = Math.max(0, length - 1.2).toFixed(2);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", score,
    "-t", length.toFixed(2),
    "-vf", `fade=t=in:st=0:d=0.6,fade=t=out:st=${fadeOut}:d=1.2,format=yuv420p`,
    "-af", `afade=t=out:st=${fadeOut}:d=1.2`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-tune", "animation", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", final,
  ]);
  console.log(`saved ${final} (${length.toFixed(1)} s)`);
}
