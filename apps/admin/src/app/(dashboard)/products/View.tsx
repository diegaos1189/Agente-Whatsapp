import { apiServerFetchScoped } from "@/lib/apiServer";
import type { CategoryDTO, BusinessSettingsDTO } from "@pollos/shared";
import { ProductsTabs } from "./ProductsTabs";
import { MenuImagesEditor } from "./MenuImagesEditor";

export async function ProductsView({
  restaurantId,
  restaurantName,
}: {
  /** Restaurante del panel abierto. Sin valor = el restaurante de este deployment. */
  restaurantId?: string;
  /** Nombre del negocio, para que el subtitulo diga de quien es el catalogo que se esta editando. */
  restaurantName?: string;
} = {}) {
  const [categories, settings] = await Promise.all([
    apiServerFetchScoped<CategoryDTO[]>("/api/products", restaurantId),
    apiServerFetchScoped<BusinessSettingsDTO>("/api/settings", restaurantId),
  ]);
  const allProducts = categories.flatMap((c) => c.products);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Productos</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          {restaurantName ? `Catálogo de ${restaurantName}. ` : ""}Es el que usa el agente para tomar pedidos.
        </p>
      </div>

      <div style={{ marginBottom: 24, maxWidth: 480 }}>
        <MenuImagesEditor menuImages={settings.menuImages} />
      </div>

      <ProductsTabs categories={categories} allProducts={allProducts} />
    </div>
  );
}
