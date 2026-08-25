import { apiServerFetch } from "@/lib/apiServer";
import type { CategoryDTO } from "@pollos/shared";
import { AddCategoryForm } from "./AddCategoryForm";
import { MenuOrderPanel } from "./MenuOrderPanel";
import { ProductsManager } from "./ProductsManager";

export default async function ProductsPage() {
  const categories = await apiServerFetch<CategoryDTO[]>("/api/products");
  const allProducts = categories.flatMap((c) => c.products);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Productos</h2>
        <p className="muted" style={{ marginTop: 4 }}>Catálogo que usa el agente para tomar pedidos.</p>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", maxWidth: 320 }}>
          <AddCategoryForm categories={categories} />
        </div>
        <div style={{ flex: "1 1 300px", maxWidth: 360 }}>
          <MenuOrderPanel categories={categories} />
        </div>
      </div>

      <ProductsManager categories={categories} allProducts={allProducts} />
    </div>
  );
}
