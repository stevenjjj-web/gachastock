"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { useI18n } from "@/lib/i18n";

export default function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const { t } = useI18n();
  if (publicKey) {
    const a = publicKey.toBase58();
    return (
      <button className="btn btn-sm btn-dark font-mono" onClick={() => disconnect()} title={t("wallet.disconnect")}>
        {a.slice(0, 4)}…{a.slice(-4)}
      </button>
    );
  }
  return (
    <button className="btn btn-sm" onClick={() => setVisible(true)} disabled={connecting}>
      {connecting ? t("wallet.connecting") : t("wallet.connect")}
    </button>
  );
}
