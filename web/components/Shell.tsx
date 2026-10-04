"use client";

import dynamic from "next/dynamic";
import { IS_CHAIN_MODE } from "@/lib/config";
import { DemoProvider } from "@/lib/demo-provider";
import { I18nProvider } from "@/lib/i18n";
import { Header, StatusBar } from "./Header";

const ChainProvider = dynamic(() => import("@/lib/chain-provider"), { ssr: false });

/** App frame shared by every page: providers, top nav and the status bar. */
export function Shell({ children }: { children: React.ReactNode }) {
  const Provider = IS_CHAIN_MODE ? ChainProvider : DemoProvider;
  return (
    <I18nProvider>
      <Provider>
        <Header />
        <main className="mx-auto w-full max-w-[1180px] px-4 pb-20 pt-6">{children}</main>
        <StatusBar />
      </Provider>
    </I18nProvider>
  );
}
