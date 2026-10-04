"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { FEE_SPLIT, SEASON } from "@/lib/config";
import { usd } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/locales/en";
import { BullHead } from "./art";

const STEPS: { n: string; title: Key; text: Key }[] = [
  { n: "1", title: "how.step1.title", text: "how.step1.text" },
  { n: "2", title: "how.step2.title", text: "how.step2.text" },
  { n: "3", title: "how.step3.title", text: "how.step3.text" },
];

// Where a pack price goes on a launchpad machine. Official machines have no coin, so that
// share goes to the prize pool instead.
const FEE_PCT = (SEASON.feeBps - FEE_SPLIT.rebateBps) / 100;
const SPLIT: { label: Key; text: Key; pct: number; color: string }[] = [
  { label: "how.floor", text: "how.floorText", pct: 100 - (SEASON.feeBps + SEASON.poolBps) / 100, color: "#1FC7D4" },
  { label: "how.pool", text: "how.poolText", pct: SEASON.poolBps / 100, color: "#A881FC" },
  { label: "how.coin", text: "how.coinText", pct: FEE_SPLIT.rebateBps / 100, color: "#31D0AA" },
  { label: "how.fee", text: "how.feeText", pct: FEE_PCT, color: "#FFC72C" },
];

export function HowItWorks({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Rendered into the body: the header's backdrop filter would otherwise clip a fixed child
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm md:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("how.title")} className="panel w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{t("how.title")}</h2>
          <button onClick={onClose} aria-label={t("stage.close")} className="h-9 w-9 rounded-lg border border-line text-xl text-subtle hover:text-ink">
            ×
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-xl border border-line bg-surface-2 p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-bold text-accent-ink">{s.n}</span>
              <p className="mt-3 font-bold">{t(s.title)}</p>
              <p className="mt-1 text-sm text-subtle">{t(s.text)}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-line bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">{t("how.split")}</p>
            <p className="flex items-center gap-2 text-sm font-semibold text-accent">
              <BullHead size={20} /> {t("how.motto")}
            </p>
          </div>
          <div className="mt-3 flex h-8 overflow-hidden rounded-lg">
            {SPLIT.map((s) => (
              <div key={s.label} className="flex items-center justify-center text-sm font-bold text-black" style={{ width: `${s.pct}%`, background: s.color }}>
                {s.pct >= 10 && `${s.pct}%`}
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {SPLIT.map((s) => (
              <div key={s.label}>
                <p className="text-sm font-bold" style={{ color: s.color }}>
                  {s.pct}% {t(s.label)}
                </p>
                <p className="text-xs text-subtle">{t(s.text)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <p className="font-bold">{t("how.jackpot.title")}</p>
            <p className="mt-1 text-sm text-subtle">{t("how.jackpot.text", { amount: usd(SEASON.jackpotMinPool, 0) })}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <p className="font-bold">{t("how.coin.title")}</p>
            <p className="mt-1 text-sm text-subtle">{t("how.coin.text", { rebate: FEE_SPLIT.rebateBps / 100 })}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <p className="font-bold">{t("how.launch.title")}</p>
            <p className="mt-1 text-sm text-subtle">{t("how.launch.text", { pct: FEE_SPLIT.creatorBps / 100 })}</p>
          </div>
        </div>

        <p className="mt-5 text-xs leading-relaxed text-subtle">{t("footer.disclaimer")}</p>
      </div>
    </div>,
    document.body,
  );
}
