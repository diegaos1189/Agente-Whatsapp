"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { CategoryDTO, ProductDTO, ProductRecommendationDTO } from "@pollos/shared";

const TYPE_LABELS: Record<string, string> = {
  UPSELL: "Upsell (version mas grande/mejor)",
  CROSS_SELL: "Cross-sell (producto complementario)",
  ADD_ON: "Adicional (extra pequeño)",
};

export function RecommendationsManager({
  categories,
  allProducts,
  initialRules,
}: {
  categories: CategoryDTO[];
  allProducts: ProductDTO[];
  initialRules: ProductRecommendationDTO[];
}) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [sourceKind, setSourceKind] = useState<"product" | "category">("product");
  const [sourceProductId, setSourceProductId] = useState(allProducts[0]?.id ?? "");
  const [sourceCategoryId, setSourceCategoryId] = useState(categories[0]?.id ?? "");
  const [recommendedProductId, setRecommendedProductId] = useState(allProducts[0]?.id ?? "");
  const [recommendationType, setRecommendationType] = useState<"UPSELL" | "CROSS_SELL" | "ADD_ON">("CROSS_SELL");
  const [priority, setPriority] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const fresh = await apiClientFetch<ProductRecommendationDTO[]>("/recommendations");
    setRules(fresh);
    router.refresh();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClientFetch("/recommendations", {
        method: "POST",
        body: JSON.stringify({
          sourceProductId: sourceKind === "product" ? sourceProductId : null,
          sourceCategoryId: sourceKind === "category" ? sourceCategoryId : null,
          recommendedProductId,
          recommendationType,
          priority: Number(priority) || 0,
        }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la regla");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(rule: ProductRecommendationDTO) {
    await apiClientFetch(`/recommendations/${rule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !rule.active }),
    });
    await refresh();
  }

  async function remove(rule: ProductRecommendationDTO) {
    await apiClientFetch(`/recommendations/${rule.id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <form className="card-form" onSubmit={handleCreate} style={{ gap: 12, maxWidth: 640 }}>
        <h4 style={{ margin: 0 }}>Nueva regla</h4>
        <div style={{ display: "flex", gap: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" checked={sourceKind === "product"} onChange={() => setSourceKind("product")} />
            Origen: un producto
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" checked={sourceKind === "category"} onChange={() => setSourceKind("category")} />
            Origen: una categoría
          </label>
        </div>

        {sourceKind === "product" ? (
          <label>
            Cuando el carrito tenga este producto...
            <select value={sourceProductId} onChange={(e) => setSourceProductId(e.target.value)}>
              {allProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.categoryName} — {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Cuando el carrito tenga algo de esta categoría...
            <select value={sourceCategoryId} onChange={(e) => setSourceCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          ...ofrecer este producto
          <select value={recommendedProductId} onChange={(e) => setRecommendedProductId(e.target.value)}>
            {allProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.categoryName} — {p.name}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ flex: 1 }}>
            Tipo
            <select value={recommendationType} onChange={(e) => setRecommendationType(e.target.value as typeof recommendationType)}>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            Prioridad (mayor = se ofrece primero)
            <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </label>
        </div>

        {error && <div className="error-text">{error}</div>}

        <button type="submit" className="cta" disabled={saving}>
          {saving ? "Guardando..." : "Crear regla"}
        </button>
      </form>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Origen</th>
              <th>Recomienda</th>
              <th>Tipo</th>
              <th>Prioridad</th>
              <th>Activa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Sin reglas todavía.
                </td>
              </tr>
            )}
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.sourceProductId ? rule.sourceProductName : `Categoría: ${rule.sourceCategoryName}`}</td>
                <td>{rule.recommendedProductName}</td>
                <td>{TYPE_LABELS[rule.recommendationType] ?? rule.recommendationType}</td>
                <td>{rule.priority}</td>
                <td>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={rule.active} onChange={() => toggleActive(rule)} />
                  </label>
                </td>
                <td>
                  <button type="button" className="danger" onClick={() => remove(rule)} style={{ padding: "2px 8px", fontSize: 11 }}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
