"use client";

import { useEffect, useRef, useState } from "react";
import { DICTS, LOCALES, setLocale, useI18n } from "@/lib/i18n";

export function LanguageMenu() {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("lang.aria")}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="label flex h-9 items-center gap-1.5 rounded-[10px] border border-line bg-surface-2 px-3"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
        {locale}
      </button>
      {open && (
        <ul role="listbox" aria-label={t("lang.aria")} className="panel absolute right-0 top-11 z-50 max-h-[70vh] w-48 overflow-y-auto p-1.5 shadow-2xl">
          {LOCALES.map((l) => (
            <li key={l} role="option" aria-selected={l === locale}>
              <button
                lang={l}
                onClick={() => {
                  setLocale(l);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-surface-2 ${
                  l === locale ? "text-accent" : "text-ink"
                }`}
              >
                {DICTS[l]["lang.name"]}
                {l === locale && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
