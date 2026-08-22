import { apiServerFetch } from "@/lib/apiServer";
import type { CategoryDTO, PromotionDTO } from "@pollos/shared";
import { AddPromotionForm } from "./AddPromotionForm";
import { PromotionRow } from "./PromotionRow";

export default async function PromotionsPage() {
  const [promotions, categories] = await Promise.all([
    apiServerFetch<PromotionDTO[]>("/api/promotions/all"),
    apiServerFetch<CategoryDTO[]>("/api/products"),
  ]);
  const products = categories.flatMap((c) => c.products);

  return (
    <div>
      <h2>Promociones</h2>

      <div style={{ marginBottom: 24 }}>
        <AddPromotionForm products={products} />
      </div>

      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Título</th>
            <th>Descripción</th>
            <th>Producto / descuento</th>
            <th>Días</th>
            <th>Activa</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {promotions.map((p) => (
            <PromotionRow key={p.id} promotion={p} products={products} />
          ))}
          {promotions.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Aún no hay promociones.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
