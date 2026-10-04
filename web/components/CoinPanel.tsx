"use client";

import { useState } from "react";
import { COIN, MARKET, USDC } from "@/lib/config";
import { coinPrice, quoteBuy, quoteRebate, quoteSell } from "@/lib/engine";
import { usd } from "@/lib/format";
import { useGacha } from "@/lib/gacha-context";
import { useI18n } from "@/lib/i18n";
import type { MachineInfo } from "@/lib/types";

/** Coin amounts shortened to K / M. */
export const coins = (base: number) => {
  const n = base / COIN;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(n >= 1 ? 0 : 2);
};

/** Tiny per-coin prices with enough digits to see them move. */
export const priceText = (p: number) => `$${p < 0.01 ? p.toFixed(8) : p.toFixed(4)}`;

type Market = MachineInfo & { coin: NonNullable<MachineInfo["coin"]> };

export function CoinPanel({ m }: { m: Market }) {
  const g = useGacha();
  const { t, err } = useI18n();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { coin } = m;

  const value = Number(amount) || 0;
  const usdcIn = Math.floor(value * USDC);
  const coinsIn = Math.min(Math.floor(value * COIN), coin.held);
  const buyQuote = quoteBuy(coin, usdcIn);
  const sellQuote = quoteSell(coin, coinsIn);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setAmount("");
    } catch (e) {
      console.error(e);
      setError(err(e, "err.action"));
    } finally {
      setBusy(false);
    }
  };

  const raisedPct = Math.min(100, (coin.marketUsdc / MARKET.target) * 100);
  const rows: [string, string][] = [
    coin.graduated ? [t("coin.pool"), `$${usd(coin.marketUsdc, 0)}`] : [t("coin.raised"), `$${usd(coin.marketUsdc, 0)} / $${usd(MARKET.target, 0)}`],
    [t("coin.rebated"), `${coins(coin.rebatedCoins)} ${m.symbol} · $${usd(coin.rebatedUsdc, 0)}`],
    [t("coin.perPull"), `${coins(quoteRebate(coin))} ${m.symbol}`],
    [t("coin.holding"), `${coins(coin.held)} ${m.symbol}`],
  ];

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="label">{t("coin.title")}</h2>
        <span className="font-mono text-sm text-subtle">${m.symbol}</span>
        <span className="ml-auto font-mono text-lg font-bold">{priceText(coinPrice(coin))}</span>
      </div>

      {!coin.graduated && (
        <div className="mb-3">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${raisedPct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-subtle">{t("coin.progress", { pct: Math.floor(raisedPct) })}</p>
        </div>
      )}

      <dl className="flex flex-col gap-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-subtle">{k}</dt>
            <dd className="text-right font-mono font-bold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button aria-pressed={side === "buy"} className="chip justify-center" onClick={() => setSide("buy")}>
          {t("coin.buy")}
        </button>
        <button aria-pressed={side === "sell"} className="chip justify-center" onClick={() => setSide("sell")}>
          {t("coin.sell")}
        </button>
      </div>

      <label className="mt-3 block">
        <span className="label mb-1.5 flex justify-between text-subtle">
          {side === "buy" ? t("coin.amountUsdc") : t("coin.amountCoins", { sym: m.symbol })}
          {side === "sell" && coin.held > 0 && (
            <button type="button" className="text-accent" onClick={() => setAmount(String(coin.held / COIN))}>
              {t("coin.max")}
            </button>
          )}
        </span>
        <input className="input font-mono" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
      </label>
      {side === "buy" && (
        <div className="mt-2 flex gap-2">
          {[10, 50, 100].map((v) => (
            <button key={v} className="chip !h-8 flex-1 justify-center font-mono !text-xs" onClick={() => setAmount(String(v))}>
              ${v}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 flex justify-between text-sm">
        <span className="text-subtle">{t("coin.youGet")}</span>
        <span className="font-mono font-bold">{side === "buy" ? `${coins(buyQuote.coins)} ${m.symbol}` : `$${usd(sellQuote)}`}</span>
      </p>

      {!g.connected ? (
        <button className="btn mt-3 w-full" onClick={g.connect} disabled={!g.connect}>
          {t("wallet.connect")}
        </button>
      ) : side === "buy" ? (
        <button
          className="btn mt-3 w-full"
          disabled={busy || buyQuote.coins <= 0 || buyQuote.cost > g.usdc}
          onClick={() => act(() => g.coinBuy(m.id, usdcIn))}
        >
          {busy ? t("cta.working") : buyQuote.cost > g.usdc ? t("cta.short") : t("coin.buyCta", { sym: m.symbol })}
        </button>
      ) : (
        <button className="btn btn-dark mt-3 w-full" disabled={busy || coinsIn <= 0 || sellQuote <= 0} onClick={() => act(() => g.coinSell(m.id, coinsIn))}>
          {busy ? t("cta.working") : t("coin.sellCta", { sym: m.symbol })}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-failure">{error}</p>}
      <p className="mt-3 text-xs leading-relaxed text-subtle">
        {t("coin.fee")} · {t("coin.warn")}
      </p>
    </section>
  );
}
