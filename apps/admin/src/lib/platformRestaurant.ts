import { apiServerFetch } from "@/lib/apiServer";
import type { PlatformRestaurant } from "@/app/(platform)/super-admin/restaurantes/types";

/** Mismo id fijo que usa la API para el restaurante que corre en este deployment. */
export const LOCAL_RESTAURANT_ID = "local-deployment";

/**
 * Restaurante de la plataforma detras de un link publico /<slug>. Devuelve null si no
 * existe (o si el usuario no tiene permiso para consultarlo: la ruta es solo ADMIN).
 */
export async function getRestaurantBySlug(slug: string): Promise<PlatformRestaurant | null> {
  try {
    return await apiServerFetch<PlatformRestaurant>(`/api/platform/restaurants/by-slug/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }
}
