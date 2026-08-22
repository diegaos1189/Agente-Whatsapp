import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Panel Admin — Agente WhatsApp",
  description: "Panel administrativo del agente de WhatsApp",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
