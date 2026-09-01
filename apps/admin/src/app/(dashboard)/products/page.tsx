import { apiServerFetch } from "@/lib/apiServer";
import type { CategoryDTO, BusinessSettingsDTO } from "@pollos/shared";
import { ProductsTabs } from "./ProductsTabs";
import { MenuImagesEditor } from "./MenuImagesEditor";

export default async function ProductsPage() {
  const [categories, settings] = await Promise.all([
    apiServerFetch<CategoryDTO[]>("/api/products"),
    apiServerFetch<BusinessSettingsDTO>("/api/settings"),
  ]);
  const allProducts = categories.flatMap((c) => c.products);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Productos</h2>
        <p className="muted" style={{ marginTop: 4 }}>Catálogo que usa el agente para tomar pedidos.</p>
      </div>

      <div style={{ marginBottom: 24, maxWidth: 480 }}>
        <MenuImagesEditor menuImages={settings.menuImages} />
      </div>

      <ProductsTabs categories={categories} allProducts={allProducts} />
    </div>
  );
}
