"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { de } from "./locales/de";
import { en, type Dict, type Key } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { id } from "./locales/id";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { pt } from "./locales/pt";
import { th } from "./locales/th";
import { vi } from "./locales/vi";
import { zh } from "./locales/zh";

export const DICTS = { en, zh, ja, ko, th, es, pt, fr, de, vi, id } satisfies Record<string, Dict>;
export type Locale = keyof typeof DICTS;
export const LOCALES = Object.keys(DICTS) as Locale[];

const STORAGE_KEY = "gachastock-locale";
const listeners = new Set<() => void>();

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in DICTS) return saved as Locale;
  } catch {}
  return "en";
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
  listeners.forEach((l) => l());
}

export type Vars = Record<string, string | number>;

type I18n = {
  locale: Locale;
  t: (key: Key, vars?: Vars) => string;
  /** Like t, but placeholders may be React nodes. */
  rich: (key: Key, parts: Record<string, ReactNode>) => ReactNode[];
  /** Message for a caught error: translated when it is a GachaError, otherwise the fallback. */
  err: (e: unknown, fallback: Key) => string;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readLocale, () => "en" as Locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18n>(() => {
    const dict: Dict = DICTS[locale];
    const t: I18n["t"] = (key, vars) =>
      dict[key].replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m));
    return {
      locale,
      t,
      err: (e, fallback) => (e instanceof GachaError ? t(e.key, e.vars) : t(fallback)),
      rich: (key, parts) =>
        dict[key].split(/(\{\w+\})/).map((chunk, i) => {
          const name = chunk.match(/^\{(\w+)\}$/)?.[1];
          return <span key={i}>{name && name in parts ? parts[name] : chunk}</span>;
        }),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/** An error whose message is a translation key, so the UI can show it in the active language. */
export class GachaError extends Error {
  constructor(
    public key: Key,
    public vars?: Vars,
  ) {
    super(key);
  }
}
