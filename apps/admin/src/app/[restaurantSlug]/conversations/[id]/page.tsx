import { notFound } from "next/navigation";
import { getRestaurantBySlug } from "@/lib/platformRestaurant";
import { ConversationDetailView } from "@/app/(dashboard)/conversations/[id]/View";

/** Misma pantalla que la del panel de la raiz, con el chat de UN restaurante. */
export default async function Page({
  params,
}: {
  params: Promise<{ restaurantSlug: string; id: string }>;
}) {
  const { restaurantSlug, id } = await params;
  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) notFound();

  return <ConversationDetailView conversationId={id} restaurantId={restaurant.id} />;
}
