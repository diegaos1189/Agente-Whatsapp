import type { ReactNode } from "react";
import Link from "next/link";
import { apiServerFetch } from "@/lib/apiServer";
import { getSession } from "@/lib/session";
import { hasPermission, ADMIN_ROLE } from "@/lib/authConstants";
import type { BusinessSettingsDTO } from "@pollos/shared";
import { LogoutButton } from "./LogoutButton";
import { SidebarShell } from "./SidebarShell";
import { NotificationBell } from "@/components/NotificationBell";
import { NavIcon } from "./NavIcon";

async function getHeaderInfo(): Promise<{ restaurantName: string; logoUrl: string | null }> {
  try {
    const settings = await apiServerFetch<BusinessSettingsDTO>("/api/settings");
    return { restaurantName: settings.restaurantName, logoUrl: settings.logoUrl };
  } catch {
    return { restaurantName: "Panel Admin", logoUrl: null };
  }
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { restaurantName, logoUrl } = await getHeaderInfo();
  const session = getSession();
  const isAdmin = session?.role === ADMIN_ROLE;

  return (
    <div className="layout">
      <SidebarShell
        title={restaurantName}
        logoUrl={logoUrl}
        footer={
          <>
            {session && <div className="muted" style={{ fontSize: 12, padding: "0 10px 8px" }}>{session.username}</div>}
            <LogoutButton />
          </>
        }
      >
        <nav>
          {session && hasPermission(session, "metrics") && (
            <Link href="/metrics"><NavIcon name="metrics" />Métricas</Link>
          )}
          {session && hasPermission(session, "conversations") && (
            <Link href="/conversations"><NavIcon name="conversations" />Conversaciones</Link>
          )}
          {session && hasPermission(session, "orders") && (
            <Link href="/orders"><NavIcon name="orders" />Pedidos</Link>
          )}
          {session && hasPermission(session, "kitchen") && (
            <Link href="/kitchen"><NavIcon name="kitchen" />Cocina</Link>
          )}
          {session && hasPermission(session, "products") && (
            <Link href="/products"><NavIcon name="products" />Productos</Link>
          )}
          {session && hasPermission(session, "promotions") && (
            <Link href="/promotions"><NavIcon name="promotions" />Promociones</Link>
          )}
          {session && hasPermission(session, "products") && (
            <Link href="/recommendations"><NavIcon name="promotions" />Recomendaciones</Link>
          )}
          {session && hasPermission(session, "faqs") && (
            <Link href="/faqs"><NavIcon name="faqs" />Preguntas frecuentes</Link>
          )}
          {session && hasPermission(session, "facturacion") && (
            <Link href="/facturacion"><NavIcon name="facturacion" />Facturación</Link>
          )}
          {session && (
            <Link href="/capacitacion"><NavIcon name="capacitacion" />Capacitación</Link>
          )}
          {isAdmin && (
            <Link href="/settings"><NavIcon name="settings" />Configuración</Link>
          )}
          {isAdmin && (
            <Link href="/users"><NavIcon name="users" />Usuarios</Link>
          )}
        </nav>
      </SidebarShell>
      <main className="content">
        <div className="desktop-topbar">
          <NotificationBell />
        </div>
        {children}
      </main>
    </div>
  );
}
