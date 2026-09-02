import { apiServerFetchScoped } from "@/lib/apiServer";
import type { CategoryDTO, PromotionDTO } from "@pollos/shared";
import { AddPromotionForm } from "./AddPromotionForm";
import { PromotionRow } from "./PromotionRow";

export async function PromotionsView({
  restaurantId,
  basePath = "",
}: {
  /** Restaurante del panel abierto. Sin valor = el restaurante de este deployment. */
  restaurantId?: string;
  /** Prefijo de los links internos: "" en la raiz, "/<slug>" en el panel de un cliente. */
  basePath?: string;
} = {}) {
  const [promotions, categories] = await Promise.all([
    apiServerFetchScoped<PromotionDTO[]>("/api/promotions/all", restaurantId),
    apiServerFetchScoped<CategoryDTO[]>("/api/products", restaurantId),
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
