"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FEE_SPLIT, MARKET, MAX_BASKET, STOCKS, THEMES } from "@/lib/config";
import { usd } from "@/lib/format";
import { useGacha } from "@/lib/gacha-context";
import { useI18n } from "@/lib/i18n";
import { PackArt, StockCoin } from "./art";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label mb-2 flex items-baseline gap-2">
        {label}
        {hint && <span className="font-medium normal-case tracking-normal text-subtle">{hint}</span>}
      </p>
      {children}
    </div>
  );
}

export function LaunchView() {
  const g = useGacha();
  const { t, err } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [theme, setTheme] = useState(0);
  const [basket, setBasket] = useState<number[]>([2, 3, 4]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valid = name.trim().length > 0 && /^[A-Z0-9]{2,10}$/.test(symbol) && basket.length > 0;
  const fee = usd(MARKET.launchFee, 0);

  const toggleStock = (i: number) =>
    setBasket((b) => (b.includes(i) ? b.filter((x) => x !== i) : b.length < MAX_BASKET ? [...b, i] : b));

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await g.launchMachine({ name: name.trim(), symbol, theme, basket });
      router.push(`/?m=${id}`);
    } catch (e) {
      console.error(e);
      setError(err(e, "err.action"));
      setBusy(false);
    }
  };

  const steps = [
    t("launch.s1", { fee }),
    t("launch.s2", { target: usd(MARKET.target, 0), seed: usd(MARKET.seed, 0) }),
    t("launch.s3", { pct: FEE_SPLIT.creatorBps / 100, buyback: FEE_SPLIT.buybackBps / 100 }),
    t("launch.s4", { days: MARKET.saleDays }),
  ];

  return (
    <>
      <h1 className="text-3xl font-bold">{t("launch.title")}</h1>
      <p className="mt-1 max-w-2xl text-subtle">{t("launch.sub")}</p>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="panel flex flex-col gap-6 p-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <Field label={t("launch.name")}>
              <input className="input" value={name} maxLength={32} placeholder={t("launch.namePh")} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("launch.symbol")}>
              <input
                className="input font-mono uppercase"
                value={symbol}
                maxLength={10}
                placeholder="MAG7"
                onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              />
            </Field>
          </div>

          <Field label={t("launch.theme")}>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("launch.theme")}>
              {THEMES.map((th, i) => (
                <button
                  key={th.name}
                  role="radio"
                  aria-checked={theme === i}
                  aria-label={th.name}
                  onClick={() => setTheme(i)}
                  className={`h-10 w-10 rounded-lg ring-offset-2 ring-offset-surface ${theme === i ? "ring-2 ring-accent" : ""}`}
                  style={{ background: `linear-gradient(135deg, ${th.from}, ${th.to})` }}
                />
              ))}
            </div>
          </Field>

          <Field label={t("launch.basket")} hint={t("launch.basketHint", { n: MAX_BASKET })}>
            <div className="flex flex-wrap gap-2">
              {STOCKS.map((s, i) => (
                <button key={s.ticker} className="chip gap-2 !pl-1.5" aria-pressed={basket.includes(i)} onClick={() => toggleStock(i)}>
                  <StockCoin stock={s} size={24} />
                  <span className="font-mono">{s.ticker}</span>
                </button>
              ))}
            </div>
          </Field>

          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <h2 className="label mb-3">{t("launch.how")}</h2>
            <ol className="flex flex-col gap-3 text-sm text-subtle">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-ink">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="mt-3 border-t border-line pt-3 text-sm text-subtle">{t("launch.limit", { pct: MARKET.creatorMaxPct })}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-20">
          <div className="panel flex items-center gap-5 p-5">
            <PackArt theme={theme} symbol={symbol || "TICKER"} className="h-44 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-xl font-bold">{name.trim() || t("launch.namePh")}</p>
              <p className="font-mono text-subtle">${symbol || "TICKER"}</p>
              <div className="mt-3 flex -space-x-1.5">
                {basket.map((i) => (
                  <StockCoin key={i} stock={STOCKS[i]} size={26} />
                ))}
              </div>
              <p className="label mt-4 !text-[10px] text-subtle">{t("launch.earn")}</p>
              <p className="text-lg font-bold text-accent">{t("launch.earnValue", { pct: FEE_SPLIT.creatorBps / 100 })}</p>
            </div>
          </div>

          <p className="rounded-xl border border-failure/40 bg-failure/10 p-4 text-sm leading-relaxed text-ink/90">{t("coin.warn")}</p>

          {g.connected ? (
            <button className="btn btn-xl w-full" disabled={!valid || busy || !g.ready || g.usdc < MARKET.launchFee} onClick={submit}>
              {busy ? t("launch.submitting") : g.ready && g.usdc < MARKET.launchFee ? t("cta.short") : t("launch.submit", { fee })}
            </button>
          ) : (
            <button className="btn btn-xl w-full" onClick={g.connect} disabled={!g.connect}>
              {t("launch.connect")}
            </button>
          )}
          {error && <p className="text-sm text-failure">{error}</p>}
        </div>
      </div>
    </>
  );
}
