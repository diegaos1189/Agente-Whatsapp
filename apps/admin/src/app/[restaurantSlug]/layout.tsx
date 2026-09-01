import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ADMIN_ROLE } from "@/lib/authConstants";
import { getRestaurantBySlug, LOCAL_RESTAURANT_ID } from "@/lib/platformRestaurant";
import { apiServerFetchForRestaurant } from "@/lib/apiServer";
import type { BusinessSettingsDTO } from "@pollos/shared";
import { SidebarShell } from "@/app/(dashboard)/SidebarShell";
import { LogoutButton } from "@/app/(dashboard)/LogoutButton";
import { NavIcon, type NavIconName } from "@/app/(dashboard)/NavIcon";
import { RestaurantScope } from "@/components/RestaurantScope";

/**
 * Secciones del panel de un restaurante de la plataforma.
 *
 * `ready` marca las que ya estan aisladas por restaurante. Las demas se muestran igual (para
 * que el panel se lea completo, que es como va a quedar) pero sin link: hoy sus datos son los
 * del restaurante local, y linkearlas mostraria pedidos y conversaciones de otro negocio.
 */
const SECTIONS: Array<{ href: string; icon: NavIconName; label: string; ready: boolean }> = [
  { href: "metrics", icon: "metrics", label: "Métricas", ready: false },
  { href: "conversations", icon: "conversations", label: "Conversaciones", ready: false },
  { href: "orders", icon: "orders", label: "Pedidos", ready: false },
  { href: "kitchen", icon: "kitchen", label: "Cocina", ready: false },
  { href: "products", icon: "products", label: "Productos", ready: true },
  { href: "promotions", icon: "promotions", label: "Promociones", ready: false },
  { href: "recommendations", icon: "promotions", label: "Recomendaciones", ready: false },
  { href: "faqs", icon: "faqs", label: "Preguntas frecuentes", ready: false },
  { href: "facturacion", icon: "facturacion", label: "Facturación", ready: false },
  { href: "capacitacion", icon: "capacitacion", label: "Capacitación", ready: false },
  { href: "settings", icon: "settings", label: "Configuración", ready: true },
  { href: "users", icon: "users", label: "Usuarios", ready: false },
];

export default async function RestaurantPanelLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ restaurantSlug: string }>;
}) {
  const { restaurantSlug } = await params;

  // El panel de un cliente de la plataforma es territorio del dueño del producto. El
  // middleware no lo cubre (sus reglas son por prefijo fijo y aca el primer segmento es un
  // slug cualquiera), asi que la puerta se cierra aqui.
  const session = getSession();
  if (session?.role !== ADMIN_ROLE) redirect("/no-access");

  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) notFound();

  // El restaurante de este deployment ya tiene su panel de siempre en la raiz: no se duplica.
  if (restaurant.id === LOCAL_RESTAURANT_ID) redirect("/metrics");

  let logoUrl: string | null = null;
  try {
    const settings = await apiServerFetchForRestaurant<BusinessSettingsDTO>("/api/settings", restaurant.id);
    logoUrl = settings.logoUrl;
  } catch {
    // Sin configuracion legible se muestra el panel igual, solo sin logo.
  }

  return (
    <div className="layout">
      <RestaurantScope restaurantId={restaurant.id} />
      <SidebarShell
        title={restaurant.name}
        logoUrl={logoUrl}
        footer={
          <>
            <Link
              href="/super-admin/restaurantes"
              className="muted"
              style={{ display: "block", fontSize: 12, padding: "0 10px 8px" }}
            >
              ← Todos los restaurantes
            </Link>
            {session && <div className="muted" style={{ fontSize: 12, padding: "0 10px 8px" }}>{session.username}</div>}
            <LogoutButton />
          </>
        }
      >
        <nav>
          {SECTIONS.map((section) =>
            section.ready ? (
              <Link key={section.href} href={`/${restaurant.slug}/${section.href}`}>
                <NavIcon name={section.icon} />
                {section.label}
              </Link>
            ) : (
              <span
                key={section.href}
                title="Esta seccion todavia no esta separada por restaurante"
                style={{ display: "flex", alignItems: "center", opacity: 0.45, cursor: "not-allowed" }}
              >
                <NavIcon name={section.icon} />
                {section.label}
                <span className="pill pill-neutral" style={{ marginLeft: "auto", fontSize: 10 }}>
                  Pronto
                </span>
              </span>
            ),
          )}
        </nav>
      </SidebarShell>
      <main className="content">{children}</main>
    </div>
  );
}
