import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { apiServerFetch } from "@/lib/apiServer";
import type { PlatformRestaurant } from "../(platform)/super-admin/restaurantes/types";

/** Mismo id fijo que usa la API para el restaurante que corre en este deployment. */
const LOCAL_RESTAURANT_ID = "local-deployment";

/**
 * Link publico de cada restaurante de la plataforma: /<slug> (ej: /delycombos).
 *
 * El restaurante que corre en este deployment entra directo a su panel admin. Los demas son
 * solo registro por ahora (cada cliente corre su propio deployment): se muestra su ficha
 * hasta que el multi-tenant real conecte cada slug con su panel.
 */
export default async function RestaurantEntryPage({ params }: { params: Promise<{ restaurantSlug: string }> }) {
  const { restaurantSlug } = await params;

  let restaurant: PlatformRestaurant | null = null;
  try {
    restaurant = await apiServerFetch<PlatformRestaurant>(
      `/api/platform/restaurants/by-slug/${encodeURIComponent(restaurantSlug)}`,
    );
  } catch {
    restaurant = null;
  }
  if (!restaurant) notFound();

  if (restaurant.id === LOCAL_RESTAURANT_ID) {
    redirect("/metrics");
  }

  const isActive = restaurant.status === "ACTIVE";

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        style={{
          maxWidth: 460,
          width: "100%",
          background: "var(--surface-solid)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-card)",
          padding: 28,
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>{restaurant.name}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {[restaurant.address, restaurant.city].filter(Boolean).join(" · ") || "Sin dirección registrada"}
        </p>
        <p>
          <span className={`pill ${isActive ? "pill-success" : "pill-neutral"}`}>{isActive ? "Activo" : "Inactivo"}</span>
        </p>
        <p className="muted">
          Este restaurante todavía no tiene su panel conectado a este link: por ahora es solo su registro en la plataforma.
        </p>
        <Link href="/super-admin/restaurantes">← Volver a restaurantes</Link>
      </div>
    </div>
  );
}
