import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ADMIN_ROLE, hasPermission, type PermissionKey } from "@/lib/authConstants";
import { getRestaurantBySlug, LOCAL_RESTAURANT_ID } from "@/lib/platformRestaurant";
import { apiServerFetchForRestaurant } from "@/lib/apiServer";
import type { BusinessSettingsDTO } from "@pollos/shared";
import { SidebarShell } from "@/app/(dashboard)/SidebarShell";
import { LogoutButton } from "@/app/(dashboard)/LogoutButton";
import { NavIcon, type NavIconName } from "@/app/(dashboard)/NavIcon";
import { RestaurantScope } from "@/components/RestaurantScope";
import { SidebarLogoUploader } from "./SidebarLogoUploader";

/**
 * Secciones del panel de un restaurante de la plataforma.
 *
 * `permission` es la que tiene que tener el usuario para verla (null = solo ADMIN). Es la
 * misma matriz de permisos del panel de la raiz: un mesero con permiso de "kitchen" ve
 * Cocina y nada mas, sin importar por que panel entre.
 */
const SECTIONS: Array<{ href: string; icon: NavIconName; label: string; permission: PermissionKey | null }> = [
  { href: "metrics", icon: "metrics", label: "Métricas", permission: "metrics" },
  { href: "conversations", icon: "conversations", label: "Conversaciones", permission: "conversations" },
  { href: "orders", icon: "orders", label: "Pedidos", permission: "orders" },
  { href: "kitchen", icon: "kitchen", label: "Cocina", permission: "kitchen" },
  { href: "products", icon: "products", label: "Productos", permission: "products" },
  { href: "promotions", icon: "promotions", label: "Promociones", permission: "promotions" },
  { href: "recommendations", icon: "promotions", label: "Recomendaciones", permission: "products" },
  { href: "faqs", icon: "faqs", label: "Preguntas frecuentes", permission: "faqs" },
  { href: "facturacion", icon: "facturacion", label: "Facturación", permission: "facturacion" },
  { href: "capacitacion", icon: "capacitacion", label: "Capacitación", permission: null },
  { href: "settings", icon: "settings", label: "Configuración", permission: null },
  { href: "users", icon: "users", label: "Usuarios", permission: null },
];

export default async function RestaurantPanelLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ restaurantSlug: string }>;
}) {
  const { restaurantSlug } = await params;

  // El middleware no cubre estas rutas con sus reglas de prefijo (el primer segmento es un
  // slug cualquiera), asi que la puerta se cierra aqui: entra el dueño de la plataforma, o
  // un usuario de ESTE restaurante. El de otro negocio no.
  const session = getSession();
  if (!session) redirect("/login");

  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) notFound();

  const isPlatformUser = !session.restaurantId;
  const belongsHere = session.restaurantId === restaurant.id;
  if (!isPlatformUser && !belongsHere) redirect("/no-access");
  if (isPlatformUser && session.role !== ADMIN_ROLE) redirect("/no-access");

  // El restaurante de este deployment ya tiene su panel de siempre en la raiz: no se duplica.
  // Sus propios usuarios si entran por aca, que es donde los manda su login.
  if (restaurant.id === LOCAL_RESTAURANT_ID && isPlatformUser) redirect("/metrics");

  let logoUrl: string | null = null;
  try {
    const settings = await apiServerFetchForRestaurant<BusinessSettingsDTO>("/api/settings", restaurant.id);
    logoUrl = settings.logoUrl;
  } catch {
    // Sin configuracion legible se muestra el panel igual, solo sin logo.
  }

  const visibleSections = SECTIONS.filter((section) =>
    section.permission === null ? session.role === ADMIN_ROLE : hasPermission(session, section.permission),
  );

  return (
    <div className="layout">
      <RestaurantScope restaurantId={restaurant.id} />
      <SidebarShell
        title={restaurant.name}
        logoSlot={<SidebarLogoUploader logoUrl={logoUrl} restaurantName={restaurant.name} />}
        footer={
          <>
            {isPlatformUser && (
              <Link
                href="/super-admin/restaurantes"
                className="muted"
                style={{ display: "block", fontSize: 12, padding: "0 10px 8px" }}
              >
                ← Todos los restaurantes
              </Link>
            )}
            <div className="muted" style={{ fontSize: 12, padding: "0 10px 8px" }}>{session.username}</div>
            <LogoutButton />
          </>
        }
      >
        <nav>
          {visibleSections.map((section) => (
            <Link key={section.href} href={`/${restaurant.slug}/${section.href}`}>
              <NavIcon name={section.icon} />
              {section.label}
            </Link>
          ))}
        </nav>
      </SidebarShell>
      <main className="content">{children}</main>
    </div>
  );
}
