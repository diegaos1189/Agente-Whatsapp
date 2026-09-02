import { notFound } from "next/navigation";
import { getRestaurantBySlug } from "@/lib/platformRestaurant";
import { FacturacionView } from "@/app/(dashboard)/facturacion/View";

/** Misma pantalla que la del panel de la raiz, con los datos de UN restaurante. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { restaurantSlug } = await params;
  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) notFound();

  return (
    <FacturacionView
      restaurantId={restaurant.id}
      basePath={`/${restaurant.slug}`}
      searchParams={searchParams as never}
    />
  );
}
