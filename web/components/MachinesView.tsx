"use client";

import Link from "next/link";
import { useState } from "react";
import { FEE_SPLIT } from "@/lib/config";
import { coinPrice } from "@/lib/engine";
import { usd } from "@/lib/format";
import { useGacha } from "@/lib/gacha-context";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/locales/en";
import type { MachineInfo } from "@/lib/types";
import { PackArt } from "./art";
import { coins, priceText } from "./CoinPanel";
import { StatusBadge } from "./GachaView";

const FILTERS = ["all", "official", "launchpad"] as const;
const FILTER_LABEL: Record<(typeof FILTERS)[number], Key> = { all: "machines.all", official: "machine.official", launchpad: "nav.launch" };

/** Label / value pair used by the mobile cards. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label !text-[10px] text-subtle">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-bold">{children}</p>
    </div>
  );
}

export function MachinesView() {
  const g = useGacha();
  const { t } = useI18n();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  // Busiest machines first
  const machines = g.machines
    .filter((m) => filter === "all" || (filter === "official") === m.official)
    .sort((a, b) => b.volume - a.volume);

  const name = (m: MachineInfo) => (
    <span className="flex min-w-0 items-center gap-3">
      <PackArt theme={m.theme} symbol={m.symbol} className="h-12 shrink-0" />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-bold">{m.name}</span>
          <StatusBadge m={m} />
        </span>
        <span className="block truncate font-mono text-xs text-subtle">
          ${m.symbol}
          {!m.official && ` · ${t("machine.by", { who: m.creator === "you" ? t("recent.you") : m.creator })}`}
        </span>
      </span>
    </span>
  );
  const none = <span className="text-subtle">—</span>;
  const price = (m: MachineInfo) => (m.coin ? priceText(coinPrice(m.coin)) : none);
  const liquidity = (m: MachineInfo) => (m.coin ? `$${usd(m.coin.marketUsdc, 0)}` : none);
  const rebated = (m: MachineInfo) =>
    m.coin ? (
      <>
        ${usd(m.coin.rebatedUsdc, 0)} <span className="text-xs font-medium text-subtle">{coins(m.coin.rebatedCoins)}</span>
      </>
    ) : (
      none
    );
  const cols: [Key, (m: MachineInfo) => React.ReactNode, boolean][] = [
    ["col.pulls", (m) => m.totalPulls.toLocaleString("en-US"), false],
    ["col.volume", (m) => `$${usd(m.volume, 0)}`, false],
    ["col.price", price, true],
    ["col.liquidity", liquidity, true],
    ["col.rebated", rebated, true],
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("machines.title")}</h1>
          <p className="mt-1 max-w-2xl text-subtle">{t("machines.sub", { pct: FEE_SPLIT.rebateBps / 100 })}</p>
        </div>
        <Link href="/launch" className="btn">
          {t("machines.create")}
        </Link>
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t(FILTER_LABEL[f])}
          </button>
        ))}
      </div>

      {machines.length === 0 ? (
        <p className="panel mt-6 p-12 text-center text-subtle">{t("machines.empty")}</p>
      ) : (
        <>
          {/* Leaderboard table on wide screens */}
          <div className="panel mt-6 hidden overflow-hidden lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="label border-b border-line text-left !text-[10px] text-subtle">
                  <th className="w-10 px-4 py-3 font-bold">#</th>
                  <th className="px-2 py-3 font-bold">{t("col.machine")}</th>
                  {cols.map(([c]) => (
                    <th key={c} className="px-4 py-3 text-right font-bold">
                      {t(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {machines.map((m, i) => (
                  <tr key={m.id} className="relative border-b border-line last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-3 text-subtle">{i + 1}</td>
                    <td className="px-2 py-3 font-sans">
                      {/* The link stretches over the whole row */}
                      <Link href={`/?m=${m.id}`} className="after:absolute after:inset-0">
                        {name(m)}
                      </Link>
                    </td>
                    {cols.map(([c, cell, bold]) => (
                      <td key={c} className={`px-4 py-3 text-right ${bold ? "font-bold" : ""}`}>
                        {cell(m)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards on small screens */}
          <div className="mt-6 grid gap-3 md:grid-cols-2 lg:hidden">
            {machines.map((m) => (
              <Link key={m.id} href={`/?m=${m.id}`} className="panel flex flex-col gap-3 p-4">
                {name(m)}
                <div className="grid grid-cols-3 gap-3">
                  {cols.map(([c, cell]) => (
                    <Cell key={c} label={t(c)}>
                      {cell(m)}
                    </Cell>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
