import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Kanit, Noto_Sans_SC, Space_Grotesk } from "next/font/google";
import { Shell } from "@/components/Shell";
import "./globals.css";

const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin", "latin-ext", "vietnamese"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["500", "700"] });
// Fallbacks for scripts Space Grotesk does not cover
const kanit = Kanit({ variable: "--font-kanit", subsets: ["thai"], weight: ["400", "600", "700"], preload: false });
const noto = Noto_Sans_SC({ variable: "--font-noto", weight: ["400", "700"], preload: false });

export const metadata: Metadata = {
  title: "GachaStock · Rip a pack, pull a stock",
  description:
    "Open packs of tokenized US stocks on Solana. Always-on packs, limited drops with tradable pack coins, and a launchpad where anyone can create a drop. Randomness by MagicBlock VRF.",
};

export const viewport: Viewport = { themeColor: "#0a0c0a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${grotesk.variable} ${mono.variable} ${kanit.variable} ${noto.variable} antialiased`}>
      <body className="min-h-screen">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
