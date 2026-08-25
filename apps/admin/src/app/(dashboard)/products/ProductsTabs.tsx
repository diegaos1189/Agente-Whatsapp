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

function slugify(text: string): string {
  return normalize(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Categoria + todas sus subcategorias, a cualquier profundidad. */
function withDescendants(category: CategoryDTO, allCategories: CategoryDTO[]): CategoryDTO[] {
  const children = allCategories.filter((c) => c.parentCategoryId === category.id);
  return [category, ...children.flatMap((child) => withDescendants(child, allCategories))];
}

function AddSubcategoryForm({ parentCategoryId, parentLabel }: { parentCategoryId: string; parentLabel: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClientFetch("/categories", {
        method: "POST",
        body: JSON.stringify({ name, slug: slugify(name), parentCategoryId }),
      });
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando subcategoria");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="card-form"
      onSubmit={handleSubmit}
      style={{ justifyContent: "space-between", minWidth: 260, maxWidth: 320 }}
    >
      <div>
        <h4>Nueva subcategoría de {parentLabel}</h4>
        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Jugos, Gaseosas, Cerveza" required />
        </label>
        {error && <div className="error-text">{error}</div>}
      </div>
      <button type="submit" className="cta" disabled={saving || !name.trim()}>
        {saving ? "Creando..." : "Crear subcategoría"}
      </button>
    </form>
  );
}

function FixedCategoryTab({
  label,
  category,
  allCategories,
}: {
  label: string;
  category: CategoryDTO | undefined;
  allCategories: CategoryDTO[];
}) {
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

  const scopedCategories = withDescendants(category, allCategories);
  const scopedProducts = scopedCategories.flatMap((c) => c.products);

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
        El agente ofrece estos productos automáticamente después de cualquier plato principal, y también aparecen
        como su propia opción en el menú numerado de WhatsApp. Puedes agrupar productos en subcategorías (ej: Jugos,
        Gaseosas, Cerveza dentro de Bebidas).
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", maxWidth: 320 }}>
          <AddSubcategoryForm parentCategoryId={category.id} parentLabel={label} />
        </div>
        <div style={{ flex: "1 1 300px", maxWidth: 360 }}>
          <MenuOrderPanel categories={scopedCategories} />
        </div>
      </div>
      <ProductsManager categories={scopedCategories} allProducts={scopedProducts} />
    </div>
  );
}

export function ProductsTabs({ categories, allProducts }: { categories: CategoryDTO[]; allProducts: ProductDTO[] }) {
  const [tab, setTab] = useState<TabKey>("main");

  const acompanantesCategory = categories.find((c) => !c.parentCategoryId && normalize(c.name) === "acompanantes");
  const bebidasCategory = categories.find((c) => !c.parentCategoryId && normalize(c.name) === "bebidas");
  const fixedRoots = [acompanantesCategory, bebidasCategory].filter((c): c is CategoryDTO => Boolean(c));
  const fixedIds = new Set(fixedRoots.flatMap((root) => withDescendants(root, categories).map((c) => c.id)));
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

      {tab === "acompanantes" && (
        <FixedCategoryTab label="Acompañantes" category={acompanantesCategory} allCategories={categories} />
      )}
      {tab === "bebidas" && <FixedCategoryTab label="Bebidas" category={bebidasCategory} allCategories={categories} />}
    </div>
  );
}
