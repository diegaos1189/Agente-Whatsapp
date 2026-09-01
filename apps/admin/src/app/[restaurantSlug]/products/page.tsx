import { notFound } from "next/navigation";
import { apiServerFetchForRestaurant } from "@/lib/apiServer";
import { getRestaurantBySlug } from "@/lib/platformRestaurant";
import type { CategoryDTO, BusinessSettingsDTO } from "@pollos/shared";
import { ProductsTabs } from "@/app/(dashboard)/products/ProductsTabs";
import { MenuImagesEditor } from "@/app/(dashboard)/products/MenuImagesEditor";

/**
 * Catalogo de UN restaurante de la plataforma. Misma pantalla que /products, pero las
 * llamadas van marcadas con su restaurante — el catalogo que se ve y se edita aca es solo
 * el suyo. Las escrituras del navegador se acotan solas via RestaurantScope (ver layout).
 */
export default async function RestaurantProductsPage({ params }: { params: Promise<{ restaurantSlug: string }> }) {
  const { restaurantSlug } = await params;
  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) notFound();

  const [categories, settings] = await Promise.all([
    apiServerFetchForRestaurant<CategoryDTO[]>("/api/products", restaurant.id),
    apiServerFetchForRestaurant<BusinessSettingsDTO>("/api/settings", restaurant.id),
  ]);
  const allProducts = categories.flatMap((c) => c.products);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Productos</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Catálogo de {restaurant.name}. Es el que usará su agente para tomar pedidos.
        </p>
      </div>

      <div style={{ marginBottom: 24, maxWidth: 480 }}>
        <MenuImagesEditor menuImages={settings.menuImages} />
      </div>

      <ProductsTabs categories={categories} allProducts={allProducts} />
    </div>
  );
}
