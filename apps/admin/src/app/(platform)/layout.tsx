import type { ReactNode } from "react";
import Link from "next/link";
// SidebarShell es generico (titulo + logo + nav + footer, sin datos del negocio), asi que se
// reusa tal cual en vez de duplicar el colapso a hamburguesa de <860px.
import { SidebarShell } from "../(dashboard)/SidebarShell";
import { PlatformNavIcon } from "./PlatformNavIcon";

/**
 * Shell del area de plataforma (dueño del producto, no dueño de un restaurante).
 *
 * Seccion independiente del panel de un solo restaurante: no toca su nav, su layout ni
 * middleware.ts. Hoy todo corre con datos mock en memoria; la autenticacion de super admin
 * y el backend multi-tenant son trabajo posterior.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <SidebarShell
        title="Plataforma"
        footer={<div className="muted" style={{ fontSize: 12, padding: "0 10px" }}>Datos de demostración</div>}
      >
        <nav>
          <Link href="/super-admin/restaurantes">
            <PlatformNavIcon name="restaurants" />
            Restaurantes
          </Link>
        </nav>
      </SidebarShell>
      <main className="content">{children}</main>
    </div>
  );
}
