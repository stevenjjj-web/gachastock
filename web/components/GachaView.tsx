"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { FLOOR, JACKPOT, MARKET, PPM, SEASON, STOCKS, THEMES, TIERS, unlockThreshold } from "@/lib/config";
import { duration, usd, usdAuto } from "@/lib/format";
import { useGacha } from "@/lib/gacha-context";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/locales/en";
import type { MachineInfo } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { PackArt, StockCoin } from "./art";
import { CoinPanel } from "./CoinPanel";
import { OpenStage, type OpenRequest } from "./OpenStage";

const tierName = (i: number) => `tier.${i}` as Key;
export const jackpotLive = (m: MachineInfo) => m.status === "live" && m.prizePool >= SEASON.jackpotMinPool;

export function StatusBadge({ m, now }: { m: MachineInfo; now: number }) {
  const { t } = useI18n();
  if (m.official) return <span className="label rounded-md bg-white/10 px-2 py-1 !text-[10px]">{t("machine.official")}</span>;
  const status = m.status === "curve" && m.coin && now > m.coin.deadline && now > 0 ? "failed" : m.status;
  const color = { curve: "#FFC72C", live: "#31D0AA", failed: "#FF6B8B" }[status];
  return (
    <span className="label rounded-md px-2 py-1 !text-[10px]" style={{ color, background: `${color}22` }}>
      {t(`phase.${status}` as Key)}
    </span>
  );
}

function Panel({ title, icon, right, children }: { title: string; icon?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={icon} />
          </svg>
        )}
        <h2 className="label">{title}</h2>
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </section>
  );
}

/** Left column: pack art, stats and the main action. */
function StagePanel({ m, onOpen }: { m: MachineInfo; onOpen: (req: Omit<OpenRequest, "key">) => void }) {
  const g = useGacha();
  const { t, err } = useI18n();
  const now = useNow();
  const [turbo, setTurbo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const theme = THEMES[m.theme % THEMES.length];
  const count = turbo ? 10 : 1;
  const cost = count * SEASON.packPrice;
  const live = m.status === "live";

  const getTest = async () => {
    setBusy(true);
    setError("");
    try {
      await g.faucet?.();
    } catch (e) {
      setError(err(e, "err.action"));
    } finally {
      setBusy(false);
    }
  };

  let cta: { label: string; disabled?: boolean; onClick?: () => void; ghost?: boolean };
  if (m.status === "curve") cta = { label: t("cta.notOpen"), disabled: true };
  else if (m.status === "failed") cta = { label: t("cta.failed"), disabled: true };
  else if (!g.connected) cta = { label: t("cta.connect"), onClick: g.connect, disabled: !g.connect };
  else if (g.usdc < cost) cta = g.faucet ? { label: t("cta.getTest"), onClick: getTest, ghost: true } : { label: t("cta.short"), disabled: true };
  else
    cta = {
      label: t("cta.open", { price: usdAuto(cost) }),
      onClick: () => onOpen({ count, title: m.name, symbol: m.symbol, theme: m.theme, run: () => g.buy(m.id, count) }),
    };

  const stats: [string, React.ReactNode][] = live
    ? [
        [t("stat.pool"), `$${usd(m.prizePool, 0)}`],
        [
          t("stat.jackpot"),
          jackpotLive(m) ? <span className="text-accent">${usd(m.prizePool / 2, 0)}</span> : <span className="text-subtle">{t("stat.locked")}</span>,
        ],
        [t("stat.pulls"), m.totalPulls.toLocaleString("en-US")],
      ]
    : [
        [t("stat.raised"), `$${usd(m.coin?.marketUsdc ?? 0, 0)}`],
        [t("stat.pool"), `$${usd(MARKET.seed, 0)}`],
        [t("stat.endsIn"), m.status === "curve" && m.coin && now > 0 ? duration(m.coin.deadline - now) : "—"],
      ];

  const note =
    m.status === "curve"
      ? t("note.curve", { target: usd(MARKET.target, 0), seed: usd(MARKET.seed, 0) })
      : m.status === "failed"
        ? t("note.failed")
        : t("note.refund");

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-20">
      <div className="panel relative flex aspect-[16/11] items-center justify-center overflow-hidden md:aspect-[16/10]">
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 55%, ${theme.to}55 0%, ${theme.to}18 38%, transparent 70%)` }} />
        <div
          className="spin-slow pointer-events-none absolute left-1/2 top-1/2 h-[160%] w-[160%] -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
          style={{ background: `repeating-conic-gradient(from 0deg, ${theme.from} 0deg 8deg, transparent 8deg 22deg)` }}
        />
        <div className="absolute bottom-[9%] h-5 w-[34%] rounded-[50%] bg-black/60 blur-md" />
        <PackArt theme={m.theme} symbol={m.symbol} className={`float relative h-[80%] drop-shadow-[0_24px_40px_rgba(0,0,0,.6)] ${live ? "" : "opacity-60 grayscale-[35%]"}`} />
        <div className="absolute left-3 top-3">
          <StatusBadge m={m} now={now} />
        </div>
        {!m.official && <span className="label absolute right-3 top-3 font-mono text-subtle">{t("machine.by", { who: m.creator === "you" ? t("recent.you") : m.creator })}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold md:text-3xl">
          {m.name} <span className="font-mono text-lg text-subtle">${m.symbol}</span>
        </h1>
        <div className="flex -space-x-1.5">
          {m.basket.map((i) => (
            <span key={i} title={STOCKS[i].ticker}>
              <StockCoin stock={STOCKS[i]} size={28} />
            </span>
          ))}
        </div>
      </div>

      <div className="panel grid grid-cols-3 divide-x divide-line">
        {stats.map(([label, value]) => (
          <div key={label} className="px-2 py-3 text-center">
            <p className="label !text-[10px] text-subtle">{label}</p>
            <p className="mt-1 font-mono text-sm font-bold md:text-base">{value}</p>
          </div>
        ))}
      </div>

      <button className={`btn btn-xl w-full ${cta.ghost ? "btn-ghost" : ""}`} disabled={!g.ready || busy || cta.disabled} onClick={cta.onClick}>
        {busy ? t("cta.working") : cta.label}
      </button>
      {error && <p className="-mt-2 text-sm text-failure">{error}</p>}

      {live && (
        <label className="panel flex cursor-pointer items-center gap-3 px-4 py-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
          </svg>
          <span className="mr-auto">
            <span className="label block">{t("turbo.title")}</span>
            <span className="text-sm text-subtle">{t("turbo.sub")}</span>
          </span>
          <input type="checkbox" role="switch" className="peer sr-only" checked={turbo} onChange={(e) => setTurbo(e.target.checked)} />
          <span className="relative h-6 w-11 rounded-full bg-surface-2 ring-1 ring-line transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-ink after:transition-transform peer-checked:after:translate-x-5 peer-checked:after:bg-accent-ink" />
        </label>
      )}

      <p className="text-sm text-subtle">{note}</p>
    </div>
  );
}

function ChooseMachine({ machines, selected, onSelect }: { machines: MachineInfo[]; selected: string; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const now = useNow();
  // Open machines first, busiest on top; then the ones still raising
  const order = (m: MachineInfo) => (m.status === "live" ? 0 : m.status === "curve" ? 1 : 2);
  const shown = [...machines]
    .filter((m) => m.status !== "failed" || m.id === selected)
    .sort((a, b) => order(a) - order(b) || Number(b.official) - Number(a.official) || b.volume - a.volume)
    .slice(0, 7);
  return (
    <Panel
      title={t("choose.title")}
      right={
        <Link href="/machines" className="label text-accent hover:underline">
          {t("choose.all")} →
        </Link>
      }
    >
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("choose.title")}>
        {shown.map((m) => {
          const active = m.id === selected;
          return (
            <button
              key={m.id}
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(m.id)}
              className={`flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${
                active ? "border-accent bg-accent/5" : "border-line hover:border-subtle"
              }`}
            >
              <PackArt theme={m.theme} symbol={m.symbol} className="h-14 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-bold">{m.name}</span>
                  <StatusBadge m={m} now={now} />
                </span>
                <span className="flex -space-x-1 pt-1">
                  {m.basket.slice(0, 6).map((i) => (
                    <StockCoin key={i} stock={STOCKS[i]} size={18} />
                  ))}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="label block !text-[10px] text-subtle">{m.status === "live" ? t("stat.pool") : t("stat.raised")}</span>
                <span className="font-mono font-bold">${usd(m.status === "live" ? m.prizePool : (m.coin?.marketUsdc ?? 0), 0)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function PrizeTile({ tier, label, value, dim, sub }: { tier: number; label: string; value: string; dim?: boolean; sub?: string }) {
  const tm = TIERS[tier];
  return (
    <div className={dim ? "opacity-40" : ""}>
      <div
        className={`relative flex aspect-square items-center justify-center rounded-xl text-3xl font-bold text-white ${tier === JACKPOT ? "rainbow" : ""} ${dim ? "" : "shine"}`}
        style={tier === JACKPOT ? undefined : { background: `linear-gradient(160deg, ${tm.from}, ${tm.to})` }}
      >
        <span className="drop-shadow-[0_2px_0_rgba(0,0,0,.25)]">{tm.code}</span>
      </div>
      <p className="label mt-2 truncate !text-[10px]" style={{ color: tm.from }}>
        {label}
      </p>
      <p className="font-mono text-sm font-bold">{value}</p>
      {sub && <p className="text-xs text-subtle">{sub}</p>}
    </div>
  );
}

function TopPrizes({ m }: { m: MachineInfo }) {
  const { t } = useI18n();
  // Before graduation, show what the machine will open with
  const pool = m.status === "live" ? m.prizePool : MARKET.seed;
  const locked = (tier: number) => (pool < unlockThreshold(tier) ? t("rates.locked", { amount: usd(unlockThreshold(tier), 0) }) : undefined);
  const jackpotOn = pool >= SEASON.jackpotMinPool;
  return (
    <Panel title={t("top.title")} icon="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4">
      <div className="grid grid-cols-3 gap-3">
        <PrizeTile
          tier={6}
          label={t("top.jackpot")}
          value={jackpotOn ? `$${usd(pool / 2, 0)}` : t("top.halfPool")}
          dim={!jackpotOn}
          sub={jackpotOn ? t("top.halfPool") : t("rates.locked", { amount: usd(SEASON.jackpotMinPool, 0) })}
        />
        <PrizeTile tier={5} label={t(tierName(5))} value={`$${usdAuto(FLOOR + TIERS[5].bonus)}`} dim={!!locked(5)} sub={locked(5)} />
        <PrizeTile tier={4} label={t(tierName(4))} value={`$${usdAuto(FLOOR + TIERS[4].bonus)}`} dim={!!locked(4)} sub={locked(4)} />
      </div>
    </Panel>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%`, background: color }} />
    </div>
  );
}

function DropRates({ m }: { m: MachineInfo }) {
  const g = useGacha();
  const { t } = useI18n();
  const pool = m.status === "live" ? m.prizePool : MARKET.seed;
  const on = pool >= SEASON.jackpotMinPool;
  return (
    <Panel
      title={t("rates.title")}
      icon="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01"
      right={
        <span className="label !text-[10px]" style={{ color: on ? "#31D0AA" : "#9A9D92" }}>
          {on ? t("rates.jackpotLive") : t("rates.jackpotLocked", { amount: usd(SEASON.jackpotMinPool, 0) })}
        </span>
      }
    >
      {!on && (
        <div className="mb-4">
          <Bar pct={(pool / SEASON.jackpotMinPool) * 100} color="var(--accent)" />
          <p className="mt-1.5 text-right font-mono text-xs text-subtle">
            ${usd(pool, 0)} / ${usd(SEASON.jackpotMinPool, 0)}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {[6, 5, 4, 3, 2, 1, 0].map((i) => {
          const pct = (TIERS[i].ppm / PPM) * 100;
          const off = i === JACKPOT ? !on : pool < unlockThreshold(i);
          return (
            <div key={i} className={off ? "opacity-45" : ""}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="label" style={{ color: TIERS[i].from }}>
                  {t(tierName(i))}
                </span>
                <span className="font-mono text-sm">
                  <span className="mr-3 text-subtle">{i === JACKPOT ? t("top.halfPool") : `$${usdAuto(FLOOR + TIERS[i].bonus)}`}</span>
                  {Number(pct.toFixed(pct < 1 ? 2 : 1))}%
                </span>
              </div>
              <Bar pct={pct} color={TIERS[i].from} />
            </div>
          );
        })}
      </div>
      <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-center text-sm text-subtle">
        {t("rates.pity", { n: Math.max(0, SEASON.pity - g.dryStreak) })}
      </p>
    </Panel>
  );
}

function RecentOpenings() {
  const g = useGacha();
  const { t } = useI18n();
  const now = useNow();
  return (
    <Panel title={t("recent.title")} right={<span className="live-dot block" />}>
      {!g.ready || !now || g.recent.length === 0 ? (
        <p className="py-6 text-center text-sm text-subtle">{t("recent.empty")}</p>
      ) : (
        <ul className="-mx-4 -mb-4 divide-y divide-line border-t border-line">
          {g.recent.slice(0, 10).map((o) => {
            const stock = STOCKS[o.stockIdx] ?? STOCKS[0];
            return (
              <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                <StockCoin stock={stock} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {stock.ticker} <span className="font-mono text-xs font-medium text-subtle">{o.source}</span>
                  </span>
                  <span className="block truncate text-xs text-subtle">
                    {t("recent.by", { t: duration(now - o.ts), who: o.who === "you" ? t("recent.you") : o.who })}
                  </span>
                </span>
                <span className="text-right">
                  <span className="label block !text-[10px]" style={{ color: TIERS[o.tier].from }}>
                    {t(tierName(o.tier))}
                  </span>
                  <span className="font-mono text-sm font-bold">${usdAuto(o.value)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function GachaView() {
  const g = useGacha();
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const wanted = params.get("m");
  // Default to the busiest open machine
  const m =
    g.machines.find((x) => x.id === wanted) ??
    [...g.machines].filter((x) => x.status === "live").sort((a, b) => b.prizePool - a.prizePool)[0] ??
    g.machines[0];
  const open = (req: Omit<OpenRequest, "key">) => setRequest({ ...req, key: Date.now() });

  if (!m) return <p className="panel p-12 text-center text-subtle">{g.ready ? t("machines.empty") : "…"}</p>;

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <StagePanel key={m.id} m={m} onOpen={open} />
        <div className="flex flex-col gap-4">
          <ChooseMachine machines={g.machines} selected={m.id} onSelect={(id) => router.replace(`/?m=${id}`, { scroll: false })} />
          {m.coin && <CoinPanel key={m.id} m={{ ...m, coin: m.coin }} />}
          <TopPrizes m={m} />
          <DropRates m={m} />
          <RecentOpenings />
        </div>
      </div>
      <AnimatePresence>
        {request && <OpenStage key={request.key} request={request} onClose={() => setRequest(null)} onAgain={() => open(request)} />}
      </AnimatePresence>
    </>
  );
}
