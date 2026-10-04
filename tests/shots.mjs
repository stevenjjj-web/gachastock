// Screenshot tour of the demo-mode build. Usage: node shots.mjs [baseUrl] [outDir]
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:3211";
const OUT = process.argv[3] ?? "shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
p.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text().slice(0, 300)));
const click = (text) =>
  p.evaluate((t) => {
    const root = document.querySelector("[data-stage]") ?? document;
    const x = [...root.querySelectorAll("button, a")].find((e) => e.textContent.trim().includes(t) && !e.disabled);
    x?.click();
    return !!x;
  }, text);
const text = (sel) => p.evaluate((s) => document.querySelector(s)?.innerText.replace(/\n+/g, " | "), sel);
const shot = (name, full = false) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const typeAmount = async (v) => {
  await p.click("input[inputmode=decimal]", { clickCount: 3 });
  await p.keyboard.press("Backspace");
  await p.type("input[inputmode=decimal]", String(v));
  await sleep(150);
};

await p.setViewport({ width: 1440, height: 900 });
await p.goto(BASE, { waitUntil: "networkidle0" });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("gachastock-locale", "en"); });
await p.reload({ waitUntil: "networkidle0" });
await sleep(700);
await shot("e1-gacha"); await shot("e1-gacha-full", true);

// Official machine: turbo open
await p.click("input[role=switch]"); await sleep(200);
console.log("open turbo:", await click("Open · 100"));
await sleep(1300); await shot("e2-charging");
await sleep(3600); await click("Flip all"); await sleep(2600); await shot("e3-ten-flipped");
await click("Claim USDC"); await sleep(500); await click("Done"); await sleep(600);

// Live launchpad machine: trade the coin and crank a buyback
await p.goto(`${BASE}/?m=3`, { waitUntil: "networkidle0" }); await sleep(600);
await shot("e4-launchpad-live"); await shot("e4-launchpad-live-full", true);
await typeAmount(50);
console.log("buy coin:", await click("Buy $MAG7")); await sleep(400);
console.log("crank:", await click("Buy back & burn")); await sleep(400);
await click("Sell"); await sleep(200); await click("Max"); await sleep(200);
await shot("e5-coin-sell");
console.log("sell coin:", await click("Sell $MAG7")); await sleep(400);
console.log("coin panel:", await text("main section:nth-of-type(2)"));

// Machine still on its curve: buy it out so it graduates, then play it
await p.goto(`${BASE}/?m=4`, { waitUntil: "networkidle0" }); await sleep(600);
await shot("e6-curve");
for (let i = 0; i < 4; i++) { await click("+ Test USDC"); await sleep(100); }
await typeAmount(2500);
console.log("buy out the curve:", await click("Buy $DEGEN")); await sleep(600);
await shot("e7-graduated");
console.log("after graduation:", await p.evaluate(() => document.querySelector("main h1").parentElement.parentElement.innerText.replace(/\n+/g, " | ").slice(0, 260)));
console.log("open on new machine:", await click("Open · 10 USDC"));
await sleep(6000); await shot("e8-single"); await click("Claim stock"); await sleep(400); await click("Done"); await sleep(400);

await p.goto(`${BASE}/machines`, { waitUntil: "networkidle0" }); await sleep(500); await shot("e9-machines", true);
await p.goto(`${BASE}/launch`, { waitUntil: "networkidle0" }); await sleep(500);
await p.type("input[placeholder='Mag 7 Mania']", "Bull Run Club"); await p.type("input[placeholder='MAG7']", "BULL");
await sleep(300); await shot("e10-launch", true);
console.log("launch:", await click("Launch for 10 USDC")); await sleep(1200); await shot("e11-launched");
await typeAmount(100);
console.log("creator cap:", await click("Buy $BULL")); await sleep(400);
console.log("  error shown:", await p.evaluate(() => document.querySelector(".text-failure")?.innerText));
await p.goto(`${BASE}/inventory`, { waitUntil: "networkidle0" }); await sleep(500); await shot("e12-inventory", true);
await click("How it works"); await sleep(400); await shot("e13-how");

// Mobile
await p.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
for (const [path, name] of [["/", "m1-gacha"], ["/?m=3", "m2-launchpad"], ["/machines", "m3-machines"], ["/launch", "m4-launch"], ["/inventory", "m5-inventory"]]) {
  await p.goto(BASE + path, { waitUntil: "networkidle0" }); await sleep(500);
  await shot(name, true);
  console.log("mobile overflow", path, await overflow());
}
// Every locale renders without leftover placeholders
await p.setViewport({ width: 1440, height: 900 });
for (const code of ["zh", "ja", "ko", "th", "es", "pt", "fr", "de", "vi", "id"]) {
  await p.evaluate((c) => localStorage.setItem("gachastock-locale", c), code);
  let bad = [];
  for (const path of ["/?m=3", "/machines", "/launch", "/inventory"]) {
    await p.goto(BASE + path, { waitUntil: "networkidle0" }); await sleep(250);
    if (await p.evaluate(() => /\{\w+\}/.test(document.body.innerText))) bad.push(path);
    if ((await overflow()) > 0) bad.push(path + " overflow");
  }
  console.log("locale", code, bad.length ? bad : "ok");
}
await p.evaluate(() => localStorage.setItem("gachastock-locale", "zh"));
await p.goto(`${BASE}/?m=3`, { waitUntil: "networkidle0" }); await sleep(400); await shot("z1-zh", true);
await b.close();
