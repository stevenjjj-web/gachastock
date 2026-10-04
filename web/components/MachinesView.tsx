"use client";

import Link from "next/link";
import { useState } from "react";
import { MARKET } from "@/lib/config";
import { coinPrice } from "@/lib/engine";
import { usd } from "@/lib/format";
import { useGacha } from "@/lib/gacha-context";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/locales/en";
import type { MachineInfo, MachineStatus } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { PackArt } from "./art";
import { coins, priceText } from "./CoinPanel";
import { jackpotLive, StatusBadge } from "./GachaView";

const FILTERS: ("all" | MachineStatus)[] = ["all", "live", "curve", "failed"];

function Jackpot({ m }: { m: MachineInfo }) {
  const { t } = useI18n();
  if (m.status !== "live") return <span className="text-subtle">—</span>;
  return jackpotLive(m) ? (
    <span className="text-accent">${usd(m.prizePool / 2, 0)}</span>
  ) : (
    <span className="text-subtle">{t("machines.jackpotLocked")}</span>
  );
}

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
  const now = useNow();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  // Busiest machines first; machines still raising rank by how much they have raised
  const score = (m: MachineInfo) => (m.status === "live" ? 1e15 + m.volume : m.status === "curve" ? (m.coin?.marketUsdc ?? 0) : -1);
  const machines = g.machines.filter((m) => filter === "all" || m.status === filter).sort((a, b) => score(b) - score(a));

  const name = (m: MachineInfo) => (
    <span className="flex min-w-0 items-center gap-3">
      <PackArt theme={m.theme} symbol={m.symbol} className="h-12 shrink-0" />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-bold">{m.name}</span>
          <StatusBadge m={m} now={now} />
        </span>
        <span className="block truncate font-mono text-xs text-subtle">
          ${m.symbol}
          {!m.official && ` · ${t("machine.by", { who: m.creator === "you" ? t("recent.you") : m.creator })}`}
        </span>
      </span>
    </span>
  );
  const pool = (m: MachineInfo) =>
    m.status === "live" ? `$${usd(m.prizePool, 0)}` : t("machines.raised", { pct: Math.floor(((m.coin?.marketUsdc ?? 0) / MARKET.target) * 100) });
  const buyback = (m: MachineInfo) =>
    m.coin && m.status === "live" ? (
      <>
        ${usd(m.coin.boughtBack, 0)} <span className="text-xs font-medium text-subtle">🔥 {coins(m.coin.burned)}</span>
      </>
    ) : (
      <span className="text-subtle">—</span>
    );
  const price = (m: MachineInfo) => (m.coin ? priceText(coinPrice({ status: m.status, coin: m.coin })) : <span className="text-subtle">—</span>);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("machines.title")}</h1>
          <p className="mt-1 max-w-2xl text-subtle">{t("machines.sub")}</p>
        </div>
        <Link href="/launch" className="btn">
          {t("machines.create")}
        </Link>
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? t("machines.all") : t(`phase.${f}` as Key)}
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
                  {(["col.pool", "col.jackpot", "col.pulls", "col.volume", "col.buyback", "col.price"] as Key[]).map((c) => (
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
                    <td className="px-4 py-3 text-right font-bold">{pool(m)}</td>
                    <td className="px-4 py-3 text-right font-bold">
                      <Jackpot m={m} />
                    </td>
                    <td className="px-4 py-3 text-right">{m.totalPulls.toLocaleString("en-US")}</td>
                    <td className="px-4 py-3 text-right">${usd(m.volume, 0)}</td>
                    <td className="px-4 py-3 text-right font-bold">{buyback(m)}</td>
                    <td className="px-4 py-3 text-right font-bold">{price(m)}</td>
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
                  <Cell label={t("col.pool")}>{pool(m)}</Cell>
                  <Cell label={t("col.jackpot")}>
                    <Jackpot m={m} />
                  </Cell>
                  <Cell label={t("col.pulls")}>{m.totalPulls.toLocaleString("en-US")}</Cell>
                  <Cell label={t("col.volume")}>${usd(m.volume, 0)}</Cell>
                  <Cell label={t("col.buyback")}>{buyback(m)}</Cell>
                  <Cell label={t("col.price")}>{price(m)}</Cell>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
