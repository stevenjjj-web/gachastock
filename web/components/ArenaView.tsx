"use client";

import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ARENA, ASSETS, BOX_TIERS, DEPOSITS, STAKES, type Asset } from "@/lib/arena/config";
import { payout, returnPpm, settle, weights } from "@/lib/arena/math";
import { useArena, type ArenaState, type Ticket } from "@/lib/arena/use-arena";
import { IS_CHAIN_MODE, PPM, USDC } from "@/lib/config";
import { usd } from "@/lib/format";
import { useGacha } from "@/lib/gacha-context";
import { useI18n } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";

const UP = "#31D0AA";
const DOWN = "#FF6B8B";
const lev = (tier: number) => `${BOX_TIERS[tier].leverage.toLocaleString("en-US")}x`;
const pct = (ppm: number, digits = 3) => `${ppm >= 0 ? "+" : "−"}${(Math.abs(ppm) / 10_000).toFixed(digits)}%`;
const signed = (micro: number) => `${micro >= 0 ? "+" : "−"}${usd(Math.abs(micro))}`;

function Panel({ title, right, children }: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      {title && (
        <div className="mb-3 flex items-center gap-2">
          <h2 className="label">{title}</h2>
          <span className="ml-auto">{right}</span>
        </div>
      )}
      {children}
    </section>
  );
}

function SideTag({ long }: { long: boolean }) {
  const { t } = useI18n();
  const color = long ? UP : DOWN;
  return (
    <span className="label inline-flex items-center gap-1 rounded-md px-2 py-1 !text-[10px]" style={{ color, background: `${color}22` }}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden style={{ transform: long ? undefined : "rotate(180deg)" }}>
        <path d="M5 1 9 8H1z" fill="currentColor" />
      </svg>
      {long ? t("arena.long") : t("arena.short")}
    </span>
  );
}

function TierBadge({ tier, big = false }: { tier: number; big?: boolean }) {
  const tm = BOX_TIERS[tier];
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg font-mono font-bold text-black ${big ? "px-4 py-2 text-3xl" : "min-w-[72px] px-2 py-1 text-sm"}`}
      style={{ background: `linear-gradient(160deg, ${tm.from}, ${tm.to})` }}
    >
      {lev(tier)}
    </span>
  );
}

/** Live price line, with the round's start price as a dashed reference once it is locked. */
function PriceChart({ samples, start, color }: { samples: number[]; start: number; color: string }) {
  if (samples.length < 2) return <div className="h-28" />;
  const all = start > 0 ? [...samples, start] : samples;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const [W, H] = [300, 90];
  const y = (p: number) => H - 6 - ((p - lo) / span) * (H - 12);
  const points = samples.map((p, i) => `${((i / (samples.length - 1)) * W).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const last = samples[samples.length - 1];
  const stroke = start > 0 ? (last >= start ? UP : DOWN) : color;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full" aria-hidden>
      {start > 0 && <line x1="0" x2={W} y1={y(start)} y2={y(start)} stroke="#9A9D92" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** What the phase line says, and how many seconds are left in it. */
function usePhase(arena: ArenaState | null, now: number) {
  const { t } = useI18n();
  if (!arena || !now) return { label: "…", live: false, left: 0, total: 1 };
  const secs = (at: number) => Math.ceil(at - now / 1_000);
  if (arena.open) {
    if (arena.tickets === 0 || arena.lockAt === 0) return { label: t("arena.waiting"), live: false, left: 0, total: 1 };
    const left = secs(arena.lockAt);
    return { label: left > 0 ? t("arena.locksIn", { t: left }) : t("arena.locking"), live: false, left: Math.max(0, left), total: arena.openSecs };
  }
  const left = secs(arena.endAt);
  return { label: left > 0 ? t("arena.settlesIn", { t: left }) : t("arena.settling"), live: true, left: Math.max(0, left), total: arena.liveSecs };
}

function Market({ asset, arena, price, samples }: { asset: Asset; arena: ArenaState | null; price: number; samples: number[] }) {
  const { t } = useI18n();
  const now = useNow(250);
  const phase = usePhase(arena, now);
  const scale = 10 ** ARENA.priceDecimals;
  const show = (p: number) => (p / scale).toLocaleString("en-US", { minimumFractionDigits: asset.digits, maximumFractionDigits: asset.digits });
  const move = arena && !arena.open && price ? returnPpm(arena.startPrice, price) : 0;
  const [wLong, wShort] = arena ? weights(arena.buckets) : [0, 0];
  const longPct = wLong + wShort > 0 ? (wLong / (wLong + wShort)) * 100 : 50;

  return (
    <div className="flex flex-col gap-4">
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2 p-4 pb-0">
          <div>
            <p className="label text-subtle">
              {asset.symbol}/USD · {arena ? t("arena.round", { n: arena.round }) : "…"}
            </p>
            <p className="mt-1 font-mono text-4xl font-bold tabular-nums md:text-5xl" data-price>
              {price ? `$${show(price)}` : "—"}
            </p>
          </div>
          {phase.live && arena && (
            <div className="pb-1">
              <p className="label !text-[10px] text-subtle">
                {t("arena.start")} ${show(arena.startPrice)}
              </p>
              <p className="font-mono text-xl font-bold tabular-nums" style={{ color: move >= 0 ? UP : DOWN }}>
                {pct(move)}
              </p>
            </div>
          )}
          <div className="ml-auto pb-1 text-right">
            <span
              className="label inline-flex items-center gap-2 rounded-md px-2 py-1 !text-[10px]"
              style={phase.live ? { color: DOWN, background: `${DOWN}22` } : { color: "#FFC72C", background: "#FFC72C22" }}
            >
              {phase.live && <span className="live-dot" />}
              {phase.live ? t("arena.live") : t("arena.open")}
            </span>
            <p className="mt-1 font-mono text-lg font-bold" data-phase>
              {phase.label}
            </p>
          </div>
        </div>
        <PriceChart samples={samples} start={phase.live && arena ? arena.startPrice : 0} color={asset.color} />
        <div className="h-1 bg-surface-2">
          <div
            className="h-full transition-[width] duration-300 ease-linear"
            style={{ width: `${phase.total ? (phase.left / phase.total) * 100 : 0}%`, background: phase.live ? DOWN : "var(--accent)" }}
          />
        </div>
      </section>

      <Panel>
        <div className="flex items-center justify-between text-sm font-bold">
          <span style={{ color: UP }}>
            {t("arena.long")} {longPct.toFixed(0)}%
          </span>
          <span className="font-mono text-xs font-medium text-subtle">{arena ? t("arena.pool", { n: arena.tickets, amount: usd(arena.staked, 0) }) : "…"}</span>
          <span style={{ color: DOWN }}>
            {(100 - longPct).toFixed(0)}% {t("arena.short")}
          </span>
        </div>
        <div className="mt-2 flex h-3 overflow-hidden rounded-full" style={{ background: DOWN }}>
          <div className="h-full transition-[width] duration-500" style={{ width: `${longPct}%`, background: UP }} />
        </div>
      </Panel>

      <Panel title={t("arena.history")}>
        {!arena?.history.length ? (
          <p className="py-3 text-center text-sm text-subtle">{t("arena.noHistory")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {arena.history.slice(0, 6).map((h) => (
              <li key={h.round} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-20 font-mono text-subtle">{t("arena.round", { n: h.round })}</span>
                <span className="font-mono font-bold tabular-nums" style={{ color: h.rPpm >= 0 ? UP : DOWN }}>
                  {pct(h.rPpm)}
                </span>
                <span className="ml-auto text-right text-subtle">{t("arena.moved", { amount: usd(h.moved) })}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Reveal({ ticket, onDone }: { ticket: Ticket; onDone: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (ticket.tier >= 2) {
      const tm = BOX_TIERS[ticket.tier];
      confetti({ particleCount: 30 + ticket.tier * 30, spread: 70, origin: { y: 0.6 }, colors: [tm.from, tm.to, "#ffffff"], disableForReducedMotion: true, zIndex: 80 });
    }
    const timer = setTimeout(onDone, 2_200);
    return () => clearTimeout(timer);
  }, [ticket, onDone]);
  return (
    <motion.div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-bg/95"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDone}
      data-reveal
    >
      <p className="label text-subtle">{t("arena.drew")}</p>
      <motion.div initial={{ scale: 0.3, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 320, damping: 14 }}>
        <TierBadge tier={ticket.tier} big />
      </motion.div>
      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="scale-150">
        <SideTag long={ticket.long} />
      </motion.div>
    </motion.div>
  );
}

function Play({ arena, price, api }: { arena: ArenaState | null; price: number; api: ReturnType<typeof useArena> }) {
  const g = useGacha();
  const { t, err } = useI18n();
  const [stake, setStake] = useState(STAKES[1]);
  const [deposit, setDeposit] = useState(DEPOSITS[1]);
  const [busy, setBusy] = useState<"" | "enter" | "box" | "out">("");
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState<Ticket | null>(null);
  const [note, setNote] = useState("");
  const { player, where } = api;
  const inRollup = where === "rollup";
  const mine = (player?.tickets ?? []).filter((x) => x.round === arena?.round);
  const live = !!arena && !arena.open;

  const run = async (kind: typeof busy, fn: () => Promise<void>) => {
    setBusy(kind);
    setError("");
    setNote("");
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(err(e, "err.action"));
    } finally {
      setBusy("");
    }
  };
  const openBox = () =>
    run("box", async () => {
      const ticket = await api.openBox(stake * USDC);
      if (ticket) setReveal(ticket);
      else setNote(t("arena.refunded"));
    });

  // Live estimate of what each ticket would get back if the round settled right now
  const estimate = (x: Ticket) => {
    if (!arena || arena.open || !price) return null;
    const r = returnPpm(arena.startPrice, price);
    return payout(x.stake, x.long, x.tier, r, settle(arena.buckets, r), arena.feeBps) - x.stake;
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="panel relative overflow-hidden p-4">
        <AnimatePresence>{reveal && <Reveal ticket={reveal} onDone={() => setReveal(null)} />}</AnimatePresence>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="label text-subtle">{t("arena.balance")}</p>
            <p className="mt-1 font-mono text-3xl font-bold tabular-nums" data-balance>
              ${usd(player?.balance ?? 0)}
            </p>
          </div>
          {(inRollup || where === "moving" || (where === "solana" && (player?.balance ?? 0) > 0)) && (
            <button className="btn btn-sm btn-dark" disabled={!!busy || where === "moving" || (inRollup && (player?.tickets.length ?? 0) > 0)} onClick={() => run("out", api.cashOut)}>
              {busy === "out" || where === "moving" ? t("arena.cashingOut") : t("arena.cashOut")}
            </button>
          )}
        </div>

        {!api.connected ? (
          <button className="btn btn-xl mt-4 w-full" onClick={g.connect} disabled={!g.connect}>
            {t("arena.connect")}
          </button>
        ) : inRollup ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {STAKES.map((s) => (
                <button key={s} className="chip justify-center font-mono" aria-pressed={stake === s} onClick={() => setStake(s)}>
                  ${s}
                </button>
              ))}
            </div>
            <button
              className="btn btn-xl mt-3 w-full"
              disabled={!!busy || live || !arena || (player?.balance ?? 0) < stake * USDC || !!player?.pending}
              onClick={openBox}
            >
              {busy === "box" ? t("arena.drawing") : (player?.balance ?? 0) < stake * USDC ? t("arena.needBalance") : t("arena.openBox", { n: stake })}
            </button>
            {live && <p className="mt-2 text-center text-sm text-subtle">{t("arena.liveWait")}</p>}
          </>
        ) : where === "moving" ? null : (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {DEPOSITS.map((d) => (
                <button key={d} className="chip justify-center font-mono" aria-pressed={deposit === d} onClick={() => setDeposit(d)}>
                  ${d}
                </button>
              ))}
            </div>
            {g.usdc < deposit * USDC && g.faucet ? (
              <button className="btn btn-xl btn-ghost mt-3 w-full" disabled={!!busy} onClick={() => run("enter", async () => void (await g.faucet?.()))}>
                {busy ? t("cta.working") : t("cta.getTest")}
              </button>
            ) : (
              <button className="btn btn-xl mt-3 w-full" disabled={!!busy || g.usdc < deposit * USDC} onClick={() => run("enter", () => api.enter(deposit * USDC))}>
                {busy === "enter" ? t("arena.entering") : g.usdc < deposit * USDC ? t("cta.short") : t("arena.deposit", { n: deposit })}
              </button>
            )}
            <p className="mt-2 text-sm text-subtle">{t("arena.depositHint")}</p>
          </>
        )}
        {note && <p className="mt-2 text-sm text-subtle">{note}</p>}
        {error && <p className="mt-2 text-sm text-failure">{error}</p>}
      </section>

      <Panel title={t("arena.tickets")}>
        {mine.length === 0 ? (
          <p className="py-3 text-center text-sm text-subtle">{t("arena.noTickets")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-tickets>
            {mine.map((x, i) => {
              const est = estimate(x);
              return (
                <li key={i} className="flex items-center gap-3 rounded-xl border border-line p-2">
                  <TierBadge tier={x.tier} />
                  <SideTag long={x.long} />
                  <span className="font-mono text-sm text-subtle">${usd(x.stake, 0)}</span>
                  <span className="ml-auto font-mono font-bold tabular-nums" style={est === null ? undefined : { color: est >= 0 ? UP : DOWN }}>
                    {est === null ? <span className="text-sm font-medium text-subtle">{t("arena.atLock")}</span> : signed(est)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {api.results.length > 0 && (
        <Panel title={t("arena.results")}>
          <ul className="flex flex-col divide-y divide-line" data-results>
            {api.results.map((r, i) => (
              <li key={`${r.round}-${i}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-subtle">{t("arena.resultLine", { n: r.round, back: `$${usd(r.returned)}`, staked: `$${usd(r.staked, 0)}` })}</span>
                <span className="font-mono font-bold tabular-nums" style={{ color: r.returned >= r.staked ? UP : DOWN }}>
                  {signed(r.returned - r.staked)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={t("arena.odds")}>
        <ul className="flex flex-col gap-2">
          {BOX_TIERS.map((tm, i) => (
            <li key={tm.leverage} className="flex items-center gap-3">
              <TierBadge tier={i} />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${(tm.ppm / PPM) * 100}%`, background: tm.from }} />
              </div>
              <span className="w-12 text-right font-mono text-sm">{(tm.ppm / PPM) * 100}%</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={t("arena.rules")}>
        <ol className="flex flex-col gap-3 text-sm text-subtle">
          {[t("arena.rule1"), t("arena.rule2", { secs: arena?.liveSecs ?? 30 }), t("arena.rule3", { fee: (arena?.feeBps ?? 1_000) / 100 })].map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-ink">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

function Arena() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const asset = ASSETS.find((a) => a.symbol === params.get("a")) ?? ASSETS[0];
  const api = useArena(asset.feedId);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("arena.title")}</h1>
          <p className="mt-1 max-w-3xl text-subtle">{t("arena.sub")}</p>
        </div>
        <div className="flex gap-2" role="radiogroup">
          {ASSETS.map((a) => (
            <button key={a.symbol} role="radio" className="chip font-mono" aria-checked={a.symbol === asset.symbol} onClick={() => router.replace(`/arena?a=${a.symbol}`, { scroll: false })}>
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
              {a.symbol}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Market key={`market-${asset.symbol}`} asset={asset} arena={api.arena} price={api.price} samples={api.samples} />
        <Play key={`play-${asset.symbol}`} arena={api.arena} price={api.price} api={api} />
      </div>
    </>
  );
}

export function ArenaView() {
  const { t } = useI18n();
  // The arena talks to devnet and the rollup directly, so it needs the wallet providers of chain mode
  if (!IS_CHAIN_MODE) {
    return (
      <>
        <h1 className="text-3xl font-bold">{t("arena.title")}</h1>
        <p className="panel mt-6 p-12 text-center text-subtle">{t("arena.chainOnly")}</p>
      </>
    );
  }
  return <Arena />;
}
