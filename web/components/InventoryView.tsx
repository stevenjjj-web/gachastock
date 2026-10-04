"use client";

import Link from "next/link";
import { useState } from "react";
import { STOCKS, TIERS } from "@/lib/config";
import { quoteSell } from "@/lib/engine";
import { shares, usd } from "@/lib/format";
import { useGacha } from "@/lib/gacha-context";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/locales/en";
import type { MachineInfo, Pack } from "@/lib/types";
import { BullHead, PackArt, StockCoin } from "./art";
import { coins } from "./CoinPanel";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="label mb-3">{title}</h2>
      {children}
    </section>
  );
}

export function InventoryView() {
  const g = useGacha();
  const { t, err } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const unclaimed = g.packs.filter((p) => p.status === "revealed");
  // Demo packs that never got a callback are cleaned up on load, so only chain mode lists these
  const pending = g.refund ? g.packs.filter((p) => p.status === "pending") : [];
  const held = g.machines.filter((m) => (m.coin?.held ?? 0) > 0);
  const created = g.machines.filter((m) => m.mine);
  const holdings = STOCKS.filter((s) => (g.holdings[s.ticker] ?? 0) > 0);
  const pnl = g.totalWon - g.totalSpent;
  const empty = g.totalSpent === 0 && !unclaimed.length && !pending.length && !held.length && !created.length;

  const machineOf = (p: Pack): MachineInfo | undefined => g.machines.find((m) => m.id === p.machineId);
  const packName = (p: Pack) => machineOf(p)?.name ?? "";

  const run = async (key: string, fn: () => Promise<void>, fallback: Key = "err.action") => {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(err(e, fallback));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h1 className="text-3xl font-bold">{t("inv.title")}</h1>

      {!g.ready ? null : empty ? (
        <div className="panel mt-6 flex flex-col items-center gap-3 p-12 text-center">
          <BullHead size={64} />
          <p className="text-lg font-bold">{t("inv.empty")}</p>
          <Link href="/" className="btn mt-2">
            {t("inv.first")}
          </Link>
        </div>
      ) : (
        <>
          <div className="panel mt-6 grid grid-cols-3 divide-x divide-line">
            {[
              { label: t("inv.spent"), value: `$${usd(g.totalSpent, 0)}`, color: "" },
              { label: t("inv.won"), value: `$${usd(g.totalWon)}`, color: "" },
              { label: t("inv.pnl"), value: `${pnl >= 0 ? "+" : "−"}$${usd(Math.abs(pnl))}`, color: pnl >= 0 ? "var(--success)" : "var(--failure)" },
            ].map((s) => (
              <div key={s.label} className="px-2 py-4 text-center">
                <p className="label !text-[10px] text-subtle">{s.label}</p>
                <p className="mt-1 font-mono text-lg font-bold md:text-2xl" style={{ color: s.color || undefined }}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
          {error && <p className="mt-3 text-sm text-failure">{error}</p>}

          {unclaimed.length > 0 && (
            <Section title={t("inv.unclaimed")}>
              <div className="grid gap-3 md:grid-cols-2">
                {unclaimed.map((p) => {
                  const best = Math.max(...p.pulls.map((x) => x.tier));
                  return (
                    <div key={p.id} className="panel flex flex-wrap items-center gap-3 p-3">
                      <span className="flex h-11 min-w-11 items-center justify-center rounded-lg px-2 font-bold text-white" style={{ background: TIERS[best].color }}>
                        {TIERS[best].code}
                      </span>
                      <div className="mr-auto">
                        <p className="font-mono text-lg font-bold">${usd(p.lockedAmount)}</p>
                        <p className="text-sm text-subtle">
                          {t("inv.packInfo", { name: packName(p), n: p.count })}
                          {p.coins > 0 && (
                            <span className="font-mono text-accent">
                              {" "}
                              · +{coins(p.coins)} {machineOf(p)?.symbol}
                            </span>
                          )}
                        </p>
                      </div>
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => run(p.id + "stock", () => g.claim(p.id, "stock"), "err.claim")}>
                        {busy === p.id + "stock" ? t("claim.swapping") : t("claim.stock")}
                      </button>
                      <button className="btn btn-sm btn-dark" disabled={!!busy} onClick={() => run(p.id + "usdc", () => g.claim(p.id, "usdc"), "err.claim")}>
                        {busy === p.id + "usdc" ? t("claim.claiming") : t("claim.usdc")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {pending.length > 0 && (
            <Section title={t("inv.pending")}>
              <div className="grid gap-3 md:grid-cols-2">
                {pending.map((p) => (
                  <div key={p.id} className="panel flex items-center gap-3 p-3">
                    <div className="mr-auto">
                      <p className="font-mono text-lg font-bold">${usd(p.paid, 0)}</p>
                      <p className="text-sm text-subtle">
                        {t("inv.packInfo", { name: packName(p), n: p.count })} · {t("inv.refundable")}
                      </p>
                    </div>
                    <button className="btn btn-sm btn-dark" disabled={!!busy} onClick={() => run(p.id, () => g.refund!(p.id), "err.refundEarly")}>
                      {busy === p.id ? t("cta.working") : t("inv.refund")}
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {held.length > 0 && (
            <Section title={t("inv.coins")}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {held.map((m) => (
                  <Link key={m.id} href={`/?m=${m.id}`} className="panel flex items-center gap-4 p-3 hover:border-subtle">
                    <PackArt theme={m.theme} symbol={m.symbol} className="h-16 shrink-0" />
                    <div className="mr-auto min-w-0">
                      <p className="truncate font-mono font-bold">
                        {coins(m.coin!.held)} {m.symbol}
                      </p>
                      <p className="text-sm text-subtle">{t("inv.coinValue", { value: usd(quoteSell(m.coin!, m.coin!.held)) })}</p>
                    </div>
                    <span className="label text-accent">{t("inv.go")} →</span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {created.length > 0 && (
            <Section title={t("inv.created")}>
              <div className="grid gap-3 md:grid-cols-2">
                {created.map((m) => (
                  <div key={m.id} className="panel flex items-center gap-4 p-3">
                    <PackArt theme={m.theme} symbol={m.symbol} className="h-16 shrink-0" />
                    <div className="mr-auto min-w-0">
                      <Link href={`/?m=${m.id}`} className="block truncate font-bold hover:underline">
                        {m.name}
                      </Link>
                      <p className="text-sm text-subtle">
                        {t("stat.pulls")}: {m.totalPulls.toLocaleString("en-US")} · {t("inv.fees", { amount: usd(m.creatorAccrued) })}
                      </p>
                    </div>
                    <button className="btn btn-sm" disabled={!!busy || m.creatorAccrued === 0} onClick={() => run(m.id + "fees", () => g.withdrawFees(m.id))}>
                      {busy === m.id + "fees" ? t("cta.working") : t("inv.withdraw")}
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {holdings.length > 0 && (
            <Section title={t("inv.holdings")}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {holdings.map((s) => {
                  const qty = g.holdings[s.ticker];
                  return (
                    <div key={s.ticker} className="panel flex items-center gap-3 p-3">
                      <StockCoin stock={s} size={40} />
                      <div>
                        <p className="font-bold">{s.ticker}</p>
                        <p className="font-mono text-xs text-subtle">
                          {t("inv.shares", { n: shares(qty) })} · ${(qty * s.price).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {g.reset && (
            <p className="mt-8 text-center">
              <button className="text-sm font-semibold text-subtle underline" onClick={g.reset}>
                {t("inv.reset")}
              </button>
            </p>
          )}
        </>
      )}
    </>
  );
}
