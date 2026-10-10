"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { usd } from "@/lib/format";
import { useGacha } from "@/lib/gacha-context";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/locales/en";
import { BullHead } from "./art";
import { HowItWorks } from "./HowItWorks";
import { LanguageMenu } from "./LanguageMenu";

const WalletButton = dynamic(() => import("./WalletButton"), { ssr: false });

const NAV: { key: Key; href: string; icon: string }[] = [
  { key: "nav.gacha", href: "/", icon: "M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10" },
  { key: "nav.arena", href: "/arena", icon: "M13 2 4 14h7l-1 8 9-12h-7z" },
  { key: "nav.machines", href: "/machines", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
  { key: "nav.launch", href: "/launch", icon: "M5 19c0-6 3-13 7-16 4 3 7 10 7 16l-3-2H8zM12 9v4" },
  { key: "nav.inventory", href: "/inventory", icon: "M3 7h18v4H3zM5 11v9h14v-9M10 15h4" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Nav({ className }: { className: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className={className}>
      {NAV.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`label flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 transition-colors ${
              active ? "text-accent" : "text-ink/80 hover:text-ink"
            }`}
          >
            <Icon d={n.icon} />
            {t(n.key)}
          </Link>
        );
      })}
    </nav>
  );
}

function FaucetButton({ faucet }: { faucet: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await faucet();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn btn-sm btn-dark" onClick={run} disabled={busy}>
      {busy ? "…" : t("header.faucet")}
    </button>
  );
}

export function Header() {
  const g = useGacha();
  const { t } = useI18n();
  const [how, setHow] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link href="/" className="mr-2 flex shrink-0 items-center gap-2">
          <BullHead size={30} />
          <span className="hidden text-lg font-bold tracking-tight sm:inline">
            GACHA<span className="text-accent">STOCK</span>
          </span>
        </Link>
        <Nav className="hidden items-center md:flex" />
        <div className="ml-auto flex items-center gap-2">
          <button className="btn btn-sm btn-dark hidden lg:inline-flex" onClick={() => setHow(true)}>
            <Icon d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01" />
            {t("nav.how")}
          </button>
          {(g.mode === "demo" || g.connected) && (
            <span className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line bg-surface-2 pl-1.5 pr-3 font-mono text-sm font-bold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2775CA] text-[11px] text-white">$</span>
              {g.ready ? usd(g.usdc) : "—"}
            </span>
          )}
          {g.faucet && (g.mode === "demo" || g.connected) && (
            <span className="hidden sm:inline">
              <FaucetButton faucet={g.faucet} />
            </span>
          )}
          <LanguageMenu />
          {g.mode === "chain" && <WalletButton />}
        </div>
      </div>
      <Nav className="flex items-center overflow-x-auto border-t border-line px-2 md:hidden" />
      {how && <HowItWorks onClose={() => setHow(false)} />}
    </header>
  );
}

export function StatusBar() {
  const g = useGacha();
  const { t } = useI18n();
  const cluster = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 flex h-9 items-center gap-4 border-t border-line bg-bg/95 px-4 text-xs text-subtle backdrop-blur">
      <span className="flex items-center gap-2">
        <span className="live-dot" />
        {g.mode === "demo" ? t("status.demo") : cluster === "mainnet-beta" ? t("status.mainnet") : t("status.devnet")}
      </span>
      <span className="ml-auto hidden sm:inline">{t("status.vrf")}</span>
      <span>
        {t("status.pool")}: <span className="font-mono font-bold text-ink">${g.ready ? usd(g.pool.prizePool, 0) : "—"}</span>
      </span>
    </footer>
  );
}
