import type { ReactNode } from "react";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata = {
  title: "Panel Admin — Agente WhatsApp",
  description: "Panel administrativo del agente de WhatsApp",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={outfit.className}>
      <body>{children}</body>
    </html>
  );
}
