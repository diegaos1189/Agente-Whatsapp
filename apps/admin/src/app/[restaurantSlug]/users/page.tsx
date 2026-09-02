import { notFound } from "next/navigation";
import { getRestaurantBySlug } from "@/lib/platformRestaurant";
import { UsersView } from "@/app/(dashboard)/users/View";

/** Misma pantalla que la del panel de la raiz, con los datos de UN restaurante. */
export default async function Page({ params }: { params: Promise<{ restaurantSlug: string }> }) {
  const { restaurantSlug } = await params;
  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) notFound();

  return <UsersView restaurantId={restaurant.id} basePath={`/${restaurant.slug}`} restaurantName={restaurant.name} />;
}
