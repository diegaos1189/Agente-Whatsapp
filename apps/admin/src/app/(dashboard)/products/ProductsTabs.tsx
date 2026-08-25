"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryDTO, ProductDTO } from "@pollos/shared";
import { apiClientFetch } from "@/lib/apiClient";
import { AddCategoryForm } from "./AddCategoryForm";
import { MenuOrderPanel } from "./MenuOrderPanel";
import { ProductsManager } from "./ProductsManager";

type TabKey = "main" | "acompanantes" | "bebidas";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "main", label: "Productos" },
  { key: "acompanantes", label: "Acompañantes" },
  { key: "bebidas", label: "Bebidas" },
];

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function FixedCategoryTab({ label, category }: { label: string; category: CategoryDTO | undefined }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createFixedCategory() {
    setCreating(true);
    setError(null);
    try {
      await apiClientFetch("/categories", {
        method: "POST",
        body: JSON.stringify({ name: label, slug: normalize(label), parentCategoryId: null }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `No se pudo crear la categoría "${label}"`);
    } finally {
      setCreating(false);
    }
  }

  if (!category) {
    return (
      <div
        style={{
          background: "var(--surface-solid)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          textAlign: "center",
        }}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Aún no existe la categoría "{label}". Créala una vez y luego solo agregas productos aquí.
        </p>
        <button type="button" className="cta" onClick={createFixedCategory} disabled={creating}>
          {creating ? "Creando..." : `Crear categoría "${label}"`}
        </button>
        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
        El agente ofrece estos productos automáticamente después de cualquier plato principal, y también aparecen
        como su propia opción en el menú numerado de WhatsApp.
      </p>
      <ProductsManager categories={[category]} allProducts={category.products} />
    </div>
  );
}

export function ProductsTabs({ categories, allProducts }: { categories: CategoryDTO[]; allProducts: ProductDTO[] }) {
  const [tab, setTab] = useState<TabKey>("main");

  const acompanantesCategory = categories.find((c) => normalize(c.name) === "acompanantes");
  const bebidasCategory = categories.find((c) => normalize(c.name) === "bebidas");
  const fixedIds = new Set([acompanantesCategory?.id, bebidasCategory?.id].filter(Boolean));
  const mainCategories = categories.filter((c) => !fixedIds.has(c.id));
  const mainProducts = allProducts.filter((p) => !fixedIds.has(p.categoryId));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? "cta" : "secondary"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "main" && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", maxWidth: 320 }}>
              <AddCategoryForm categories={mainCategories} />
            </div>
            <div style={{ flex: "1 1 300px", maxWidth: 360 }}>
              <MenuOrderPanel categories={mainCategories} />
            </div>
          </div>
          <ProductsManager categories={mainCategories} allProducts={mainProducts} />
        </>
      )}

      {tab === "acompanantes" && <FixedCategoryTab label="Acompañantes" category={acompanantesCategory} />}
      {tab === "bebidas" && <FixedCategoryTab label="Bebidas" category={bebidasCategory} />}
    </div>
  );
}
