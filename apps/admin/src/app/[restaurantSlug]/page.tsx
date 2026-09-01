import { redirect } from "next/navigation";

/**
 * Link publico de cada restaurante de la plataforma: /<slug> (ej: /delycombos).
 *
 * Entra directo a Productos, que es lo primero que hay que cargar en un restaurante nuevo.
 * El layout de arriba resuelve el slug, corta si no existe y manda al panel de siempre si
 * el slug es el del restaurante de este deployment.
 */
export default async function RestaurantEntryPage({ params }: { params: Promise<{ restaurantSlug: string }> }) {
  const { restaurantSlug } = await params;
  redirect(`/${restaurantSlug}/products`);
}
