import { apiServerFetch } from "@/lib/apiServer";
import type { CategoryDTO, ProductRecommendationDTO } from "@pollos/shared";
import { RecommendationsManager } from "./RecommendationsManager";

export default async function RecommendationsPage() {
  const [categories, rules] = await Promise.all([
    apiServerFetch<CategoryDTO[]>("/api/products"),
    apiServerFetch<ProductRecommendationDTO[]>("/api/recommendations"),
  ]);
  const allProducts = categories.flatMap((c) => c.products);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Recomendaciones</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Reglas de upsell/cross-sell: cuando el cliente pide un producto (o algo de una categoría), el bot puede
          sugerir como máximo un adicional real del catálogo, con precio vigente. La IA nunca elige el producto —
          solo redacta la oferta que definas aquí. Actívalo en Configuración ("Upsell / adicionales sugeridos").
        </p>
      </div>
      <RecommendationsManager categories={categories} allProducts={allProducts} initialRules={rules} />
    </div>
  );
}
