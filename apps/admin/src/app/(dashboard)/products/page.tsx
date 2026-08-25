import { apiServerFetch } from "@/lib/apiServer";
import type { CategoryDTO } from "@pollos/shared";
import { ProductsTabs } from "./ProductsTabs";

export default async function ProductsPage() {
  const categories = await apiServerFetch<CategoryDTO[]>("/api/products");
  const allProducts = categories.flatMap((c) => c.products);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Productos</h2>
        <p className="muted" style={{ marginTop: 4 }}>Catálogo que usa el agente para tomar pedidos.</p>
      </div>

      <ProductsTabs categories={categories} allProducts={allProducts} />
    </div>
  );
}
