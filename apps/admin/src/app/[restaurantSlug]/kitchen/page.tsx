import { notFound } from "next/navigation";
import { getRestaurantBySlug } from "@/lib/platformRestaurant";
import { KitchenView } from "@/app/(dashboard)/kitchen/View";

/** Misma pantalla que la del panel de la raiz, con los datos de UN restaurante. */
export default async function Page({ params }: { params: Promise<{ restaurantSlug: string }> }) {
  const { restaurantSlug } = await params;
  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) notFound();

  return <KitchenView restaurantId={restaurant.id} basePath={`/${restaurant.slug}`} />;
}
