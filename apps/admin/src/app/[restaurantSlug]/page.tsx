import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ADMIN_ROLE, ROUTE_PERMISSIONS, hasPermission } from "@/lib/authConstants";

/**
 * Link publico de cada restaurante de la plataforma: /<slug> (ej: /delycombos).
 *
 * Manda a la primera seccion que el usuario pueda ver: el dueño entra a Metricas y un
 * empleado de cocina a Cocina, en vez de rebotar contra una pantalla sin permiso. El layout
 * de arriba ya resolvio el slug y corto si el restaurante no existe o no es suyo.
 */
export default async function RestaurantEntryPage({ params }: { params: Promise<{ restaurantSlug: string }> }) {
  const { restaurantSlug } = await params;
  const session = getSession();

  if (session?.role === ADMIN_ROLE) redirect(`/${restaurantSlug}/metrics`);

  const firstAllowed = session
    ? ROUTE_PERMISSIONS.find((rule) => hasPermission(session, rule.permission))
    : undefined;

  redirect(`/${restaurantSlug}${firstAllowed?.prefix ?? "/no-access"}`);
}
