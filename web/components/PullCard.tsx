"use client";

import { motion } from "motion/react";
import { JACKPOT, STOCKS, TIERS } from "@/lib/config";
import type { Pull } from "@/lib/engine";
import { shares, usd } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/locales/en";
import { Sparkle, StockCoin } from "./art";

const tierBg = (tier: number) =>
  tier === JACKPOT
    ? undefined
    : { background: `linear-gradient(160deg, ${TIERS[tier].from} 0%, ${TIERS[tier].to} 100%)` };

export const tierName = (tier: number) => `tier.${tier}` as Key;

/** Rarity face: the first reveal */
export function RarityFace({ tier, big = false, hint }: { tier: number; big?: boolean; hint?: string }) {
  const { t: tr } = useI18n();
  const t = TIERS[tier];
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center text-white overflow-hidden ${
        big ? "rounded-[28px]" : "rounded-2xl"
      } ${tier === JACKPOT ? "rainbow" : ""} ${tier >= 3 ? "shine" : ""}`}
      style={{ ...tierBg(tier), boxShadow: "inset 0 -6px 0 rgba(0,0,0,.16), inset 0 0 0 3px rgba(255,255,255,.45)" }}
    >
      {tier >= 2 && (
        <>
          <Sparkle size={big ? 26 : 12} color="#fff" className="absolute top-[12%] left-[14%] opacity-90" />
          <Sparkle size={big ? 16 : 8} color="#fff" className="absolute bottom-[18%] right-[16%] opacity-80" />
        </>
      )}
      <span
        className={`font-black leading-none drop-shadow-[0_3px_0_rgba(0,0,0,.18)] ${
          big ? (t.code.length > 2 ? "text-6xl" : "text-7xl") : t.code.length > 2 ? "text-xl md:text-3xl" : "text-2xl md:text-4xl"
        }`}
      >
        {t.code}
      </span>
      {big && <span className="mt-3 text-lg font-semibold opacity-90">{tr(tierName(tier))}</span>}
      {hint && (
        <span className={`absolute bottom-2 font-semibold opacity-80 ${big ? "text-sm bottom-5" : "text-[10px] md:text-xs"}`}>
          {hint}
        </span>
      )}
    </div>
  );
}

/** Stock face: the second reveal */
export function StockFace({ pull, big = false }: { pull: Pull; big?: boolean }) {
  const { t: tr } = useI18n();
  const t = TIERS[pull.tier];
  const stock = STOCKS[pull.stockIdx];
  const qty = pull.value / 1e6 / stock.price;
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center bg-white text-[#280D5F] overflow-hidden ${
        big ? "rounded-[28px] pt-0" : "rounded-2xl"
      }`}
      style={{ boxShadow: `inset 0 0 0 3px ${t.color}, inset 0 -6px 0 rgba(0,0,0,.08)` }}
    >
      <div
        className={`w-full text-center text-white font-extrabold ${pull.tier === JACKPOT ? "rainbow" : ""} ${
          big ? "py-2 text-lg" : "py-0.5 text-[10px] md:text-sm"
        }`}
        style={tierBg(pull.tier)}
      >
        {t.code}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-1 md:gap-2 px-1">
        <span className="md:hidden">
          <StockCoin stock={stock} size={big ? 84 : 34} />
        </span>
        <span className="hidden md:inline">
          <StockCoin stock={stock} size={big ? 96 : 56} />
        </span>
        <span className={`font-extrabold leading-none ${big ? "text-2xl mt-2" : "text-[11px] md:text-base"}`}>{stock.ticker}</span>
        <span className={`font-black leading-none ${big ? "text-4xl" : "text-sm md:text-xl"}`} style={{ color: t.color }}>
          ${usd(pull.value, pull.value % 1e6 === 0 ? 0 : 2)}
        </span>
        <span className={`text-[#7A6EAA] leading-none ${big ? "text-sm" : "hidden md:block text-xs"}`}>{tr("card.shares", { n: shares(qty) })}</span>
      </div>
    </div>
  );
}

export function PullCard({
  pull,
  flipped,
  onFlip,
  big = false,
  delay = 0,
}: {
  pull: Pull;
  flipped: boolean;
  onFlip?: () => void;
  big?: boolean;
  delay?: number;
}) {
  const { t } = useI18n();
  return (
    <motion.button
      type="button"
      onClick={onFlip}
      aria-label={flipped ? `${TIERS[pull.tier].code} ${STOCKS[pull.stockIdx].ticker}` : `${TIERS[pull.tier].code} · ${t("card.flipHint")}`}
      initial={{ y: -80, opacity: 0, scale: 0.6, rotate: -8 }}
      animate={{ y: 0, opacity: 1, scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 18, delay }}
      whileHover={flipped ? undefined : { y: -6 }}
      className={`relative cursor-pointer ${
        big ? "w-[230px] h-[322px]" : "w-[78px] h-[110px] md:w-[136px] md:h-[190px]"
      }`}
      style={{ perspective: 1000 }}
    >
      {/* Rarity glow */}
      {pull.tier >= 2 && (
        <span
          className="absolute -inset-1.5 rounded-[32px] blur-lg opacity-60"
          style={{ background: TIERS[pull.tier].color }}
        />
      )}
      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d" }}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="absolute inset-0 flip-face">
          <RarityFace tier={pull.tier} big={big} hint={big ? t("card.flipHint") : t("card.tap")} />
        </div>
        <div className="absolute inset-0 flip-face" style={{ transform: "rotateY(180deg)" }}>
          <StockFace pull={pull} big={big} />
        </div>
      </motion.div>
    </motion.button>
  );
}
