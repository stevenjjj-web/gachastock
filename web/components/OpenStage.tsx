"use client";

import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SEASON, THEMES, TIERS } from "@/lib/config";
import { usd } from "@/lib/format";
import { useGacha } from "@/lib/gacha-context";
import { useI18n } from "@/lib/i18n";
import type { ClaimAs, Pack } from "@/lib/types";
import { PackArt } from "./art";
import { coins } from "./CoinPanel";
import { PullCard } from "./PullCard";

export type OpenRequest = {
  key: number;
  count: number;
  title: string;
  symbol: string;
  theme: number;
  /** Pays and resolves once the VRF callback has revealed the pack */
  run: () => Promise<Pack>;
};

type Phase = "charging" | "burst" | "reveal" | "error";

const MIN_CHARGE_MS = 2_000;
const BURST_MS = 950;
// The pack tears along this line, as a share of its height
const TEAR = 13;

function celebrate(tier: number) {
  if (tier < 2) return;
  const colors = [TIERS[tier].from, TIERS[tier].to, "#ffffff", "#FFB237"];
  const base = { colors, disableForReducedMotion: true, zIndex: 80 };
  confetti({ ...base, particleCount: 40 + tier * 30, spread: 70 + tier * 8, origin: { y: 0.55 }, startVelocity: 38 + tier * 3 });
  if (tier >= 3) {
    setTimeout(() => confetti({ ...base, particleCount: 80, angle: 60, spread: 70, origin: { x: 0, y: 0.7 } }), 180);
    setTimeout(() => confetti({ ...base, particleCount: 80, angle: 120, spread: 70, origin: { x: 1, y: 0.7 } }), 320);
  }
}

export function OpenStage({ request, onClose, onAgain }: { request: OpenRequest; onClose: () => void; onAgain?: () => void }) {
  const { claim, mode, packs } = useGacha();
  const { t, rich, err } = useI18n();
  const [phase, setPhase] = useState<Phase>("charging");
  const [pack, setPack] = useState<Pack | null>(null);
  const [flipped, setFlipped] = useState<boolean[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [claiming, setClaiming] = useState<ClaimAs | null>(null);
  const [claimedHere, setClaimed] = useState<ClaimAs | null>(null);
  const started = useRef(false);

  // Pay → wait for the VRF callback (the shake animation covers the wait) → tear → reveal
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t0 = Date.now();
    request
      .run()
      .then(async (p) => {
        const wait = MIN_CHARGE_MS - (Date.now() - t0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        setPack(p);
        setFlipped(p.pulls.map(() => false));
        setPhase("burst");
        const best = Math.max(...p.pulls.map((x) => x.tier));
        setTimeout(() => celebrate(best), BURST_MS - 250);
        setTimeout(() => setPhase("reveal"), BURST_MS);
      })
      .catch((e: unknown) => {
        console.error(e);
        setError(e);
        setPhase("error");
      });
  }, [request]);

  // Single pull: show the rarity for a moment, then flip automatically
  useEffect(() => {
    if (phase !== "reveal" || !pack || pack.count !== 1) return;
    const timer = setTimeout(() => setFlipped([true]), 1_300);
    return () => clearTimeout(timer);
  }, [phase, pack]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // The pack may also have been claimed from Inventory
  const claimed = claimedHere ?? packs.find((p) => p.id === pack?.id)?.claimedAs ?? null;
  const best = pack ? Math.max(...pack.pulls.map((x) => x.tier)) : 0;
  const glow = pack ? TIERS[best].color : THEMES[request.theme % THEMES.length].from;
  const allFlipped = flipped.length > 0 && flipped.every(Boolean);
  const busy = phase === "charging" || phase === "burst";

  const flipOne = (i: number) => setFlipped((f) => f.map((v, j) => (j === i ? true : v)));
  const flipAll = () =>
    flipped.forEach((v, i) => {
      if (!v) setTimeout(() => flipOne(i), i * 110);
    });

  const doClaim = async (as: ClaimAs) => {
    if (!pack) return;
    setClaiming(as);
    setError(null);
    try {
      await claim(pack.id, as);
      setClaimed(as);
    } catch (e) {
      console.error(e);
      setError(e);
    } finally {
      setClaiming(null);
    }
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={t("stage.aria")}
      data-stage
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto"
      style={{ background: "radial-gradient(ellipse at center, #1c211c 0%, #0c0f0c 65%, #050605 100%)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Spinning rays, tinted by the best tier in the pack */}
      <div
        className="spin-slow pointer-events-none absolute left-1/2 top-1/2 h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2 opacity-20 transition-[background] duration-500"
        style={{
          background: `repeating-conic-gradient(from 0deg, ${glow} 0deg 9deg, transparent 9deg 24deg)`,
          maskImage: "radial-gradient(circle, #000 0%, transparent 62%)",
          WebkitMaskImage: "radial-gradient(circle, #000 0%, transparent 62%)",
        }}
      />

      {!busy && (
        <button onClick={onClose} aria-label={t("stage.close")} className="absolute right-4 top-4 z-10 h-11 w-11 rounded-xl border border-line bg-surface text-2xl text-ink hover:bg-surface-2">
          ×
        </button>
      )}

      <AnimatePresence mode="wait">
        {busy && (
          <motion.div key="pack" className="relative flex flex-col items-center" exit={{ opacity: 0, scale: 1.5 }} transition={{ duration: 0.25 }}>
            <motion.div
              className="relative w-[200px] md:w-[240px]"
              animate={
                phase === "charging"
                  ? { rotate: [0, -4, 4, -6, 6, -2, 2, 0], y: [0, -6, 0, -10, 0, -4, 0, 0], scale: [1, 1.02, 1, 1.05, 1, 1.03, 1, 1] }
                  : { rotate: 0, y: 0, scale: [1, 0.94, 1.18] }
              }
              transition={phase === "charging" ? { duration: 0.9, repeat: Infinity } : { duration: BURST_MS / 1000, times: [0, 0.25, 1] }}
            >
              <span className="absolute inset-4 rounded-full opacity-70 blur-3xl transition-colors duration-300" style={{ background: glow }} />
              {/* Light pouring out of the torn pack */}
              {phase === "burst" && (
                <motion.span
                  className="absolute left-1/2 w-[76%] -translate-x-1/2 rounded-full blur-md"
                  style={{ top: `${TEAR}%`, background: `linear-gradient(0deg, ${glow}, #fff)` }}
                  initial={{ height: 0, opacity: 0, y: 0 }}
                  animate={{ height: 380, opacity: [0, 1, 1], y: -380 }}
                  transition={{ duration: 0.55, delay: 0.25 }}
                />
              )}
              {/* The same pack drawn twice, clipped at the tear line, so the top strip can fly off */}
              <div className="relative" style={{ clipPath: `inset(${TEAR}% 0 0 0)` }}>
                <PackArt theme={request.theme} symbol={request.symbol} className="block w-full" />
              </div>
              <motion.div
                className="absolute inset-0"
                style={{ clipPath: `inset(0 0 ${100 - TEAR}% 0)` }}
                animate={phase === "burst" ? { y: -200, x: -80, rotate: -32, opacity: 0 } : { y: 0 }}
                transition={{ duration: 0.6, delay: phase === "burst" ? 0.22 : 0, ease: "easeOut" }}
              >
                <PackArt theme={request.theme} symbol={request.symbol} className="block w-full" />
              </motion.div>
            </motion.div>
            <p className="label mt-10 !text-base text-ink">
              {phase === "charging" ? t("stage.rolling") : t("stage.pop")}
              {phase === "charging" && <Dots />}
            </p>
            <p className="mt-2 text-sm text-subtle">
              {request.title}
              {request.count > 1 && ` × ${request.count}`}
            </p>
          </motion.div>
        )}

        {phase === "reveal" && pack && (
          <motion.div key="cards" className="relative flex w-full max-w-4xl flex-col items-center px-4 py-16" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.p
              className="mb-6 text-center text-2xl font-bold text-ink md:text-3xl"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 14 }}
            >
              {best >= 2
                ? rich("stage.got", { tier: <span style={{ color: TIERS[best].from }}>{TIERS[best].code}</span> })
                : t("stage.opened")}
            </motion.p>

            {pack.count === 1 ? (
              <PullCard big pull={pack.pulls[0]} flipped={flipped[0]} onFlip={() => flipOne(0)} />
            ) : (
              <div className="flex max-w-[760px] flex-wrap justify-center gap-3 md:gap-4">
                {pack.pulls.map((pull, i) => (
                  <PullCard key={i} pull={pull} flipped={flipped[i]} onFlip={() => flipOne(i)} delay={i * 0.07} />
                ))}
              </div>
            )}

            <div className="mt-8 flex min-h-[160px] flex-col items-center gap-4">
              {!allFlipped && pack.count > 1 && (
                <button className="btn" onClick={flipAll}>
                  {t("stage.flipAll")}
                </button>
              )}
              {allFlipped && (
                <motion.div className="flex flex-col items-center gap-4" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35 }}>
                  <p className="text-subtle">
                    {t("stage.total")} <span className="text-gold font-mono text-3xl font-bold">${usd(pack.lockedAmount)}</span>
                    <span className="ml-2 text-sm">{t("stage.cost", { n: usd(pack.paid, 0) })}</span>
                  </p>
                  {pack.coins > 0 && (
                    <p className="-mt-2 font-semibold text-accent" data-coins>
                      {t("stage.coins", { n: coins(pack.coins), sym: request.symbol })}
                    </p>
                  )}
                  {claimed ? (
                    <>
                      <p className="font-semibold text-success">
                        {claimed === "stock" ? t("stage.stockDone") : t("stage.usdcDone")}
                        {mode === "demo" && ` ${t("stage.demo")}`}
                      </p>
                      <div className="flex gap-3">
                        {onAgain && (
                          <button className="btn" onClick={onAgain}>
                            {t("stage.again")}
                          </button>
                        )}
                        <button className="btn btn-dark" onClick={onClose}>
                          {t("stage.done")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap justify-center gap-3">
                        <button className="btn" disabled={!!claiming} onClick={() => doClaim("stock")}>
                          {claiming === "stock" ? t("claim.swapping") : t("claim.stock")}
                        </button>
                        <button className="btn btn-dark" disabled={!!claiming} onClick={() => doClaim("usdc")}>
                          {claiming === "usdc" ? t("claim.claiming") : t("claim.usdc")}
                        </button>
                      </div>
                      <p className="max-w-xs text-center text-xs text-subtle">{t("stage.fee", { pct: SEASON.settleFeeBps / 100 })}</p>
                      {error != null && <p className="text-sm text-failure">{err(error, "err.claim")}</p>}
                    </>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {phase === "error" && (
          <motion.div key="err" className="relative flex flex-col items-center gap-5 px-6 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p className="text-2xl font-bold text-ink">{t("stage.failed")}</p>
            <p className="max-w-sm text-subtle">{err(error, "err.open")}</p>
            <button className="btn" onClick={onClose}>
              {t("stage.back")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Dots() {
  return (
    <span className="inline-flex w-8 justify-start">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}>
          .
        </motion.span>
      ))}
    </span>
  );
}
