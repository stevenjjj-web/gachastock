"use client";

import { createContext, useContext } from "react";
import type { GachaApi } from "./types";

export const GachaContext = createContext<GachaApi | null>(null);

export function useGacha(): GachaApi {
  const ctx = useContext(GachaContext);
  if (!ctx) throw new Error("useGacha must be used inside a GachaProvider");
  return ctx;
}
