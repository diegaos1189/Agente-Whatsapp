"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { CategoryDTO } from "@pollos/shared";

function childrenOf(categories: CategoryDTO[], parentId: string | null): CategoryDTO[] {
  return categories.filter((c) => (c.parentCategoryId ?? null) === parentId);
}

function hasDescendant(categories: CategoryDTO[], id: string): boolean {
  return categories.some((c) => c.parentCategoryId === id);
}

export function MenuOrderPanel({ categories }: { categories: CategoryDTO[] }) {
  const router = useRouter();
  const [moving, setMoving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteCategory(id: string, name: string) {
    if (!confirm(`¿Eliminar la categoría "${name}"?`)) return;
    setDeleting(id);
    setDeleteError(null);
    try {
      await apiClientFetch(`/categories/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "No se pudo eliminar la categoría");
    } finally {
      setDeleting(null);
    }
  }

  // Reordena solo entre hermanos (misma categoria padre) — nunca intercambia con una
  // categoria de otra rama del arbol, aunque su sortOrder este cerca en la base de datos.
  async function moveCategory(siblings: CategoryDTO[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;

    const current = siblings[index];
    const target = siblings[targetIndex];
    setMoving(current.id);
    try {
      await Promise.all([
        apiClientFetch(`/categories/${current.id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: target.sortOrder }) }),
        apiClientFetch(`/categories/${target.id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: current.sortOrder }) }),
      ]);
      router.refresh();
    } finally {
      setMoving(null);
    }
  }

  async function move(categoryProducts: CategoryDTO["products"], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categoryProducts.length) return;

    const current = categoryProducts[index];
    const target = categoryProducts[targetIndex];
    setMoving(current.id);
    try {
      // Se intercambia el sortOrder entre los dos productos vecinos — asi el orden
      // relativo del resto de la categoria no se altera, solo estos dos suben/bajan.
      await Promise.all([
        apiClientFetch(`/products/${current.id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: target.sortOrder }) }),
        apiClientFetch(`/products/${target.id}`, { method: "PATCH", body: JSON.stringify({ sortOrder: current.sortOrder }) }),
      ]);
      router.refresh();
    } finally {
      setMoving(null);
    }
  }

  function renderCategory(cat: CategoryDTO, siblings: CategoryDTO[], index: number, depth: number) {
    const subcategories = childrenOf(categories, cat.id);
    const blockedByProducts = cat.products.length > 0;
    const blockedByChildren = subcategories.length > 0;

    return (
      <div key={cat.id} style={{ marginBottom: 14, marginLeft: depth * 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => moveCategory(siblings, index, -1)}
              disabled={index === 0 || moving === cat.id}
              style={{ padding: "0 6px", fontSize: 10, lineHeight: "16px" }}
            >
              ▲
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => moveCategory(siblings, index, 1)}
              disabled={index === siblings.length - 1 || moving === cat.id}
              style={{ padding: "0 6px", fontSize: 10, lineHeight: "16px" }}
            >
              ▼
            </button>
          </div>
          {depth > 0 && <span className="muted" style={{ fontSize: 12 }}>↳</span>}
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", flex: 1 }}>
            {cat.name}
          </div>
          <button
            type="button"
            className="danger"
            onClick={() => deleteCategory(cat.id, cat.name)}
            disabled={blockedByProducts || blockedByChildren || deleting === cat.id}
            title={
              blockedByProducts
                ? "Esta categoría tiene productos asociados, muévelos o elimínalos primero"
                : blockedByChildren
                  ? "Esta categoría tiene subcategorías, muévelas o elimínalas primero"
                  : "Eliminar categoría"
            }
            style={{ padding: "2px 8px", fontSize: 10 }}
          >
            {deleting === cat.id ? "Eliminando..." : "Eliminar"}
          </button>
        </div>

        {cat.products.map((p, i) => (
          <div
            key={p.id}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "3px 0", marginLeft: 18 }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => move(cat.products, i, -1)}
                disabled={i === 0 || moving === p.id}
                style={{ padding: "0 6px", fontSize: 10, lineHeight: "16px" }}
              >
                ▲
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => move(cat.products, i, 1)}
                disabled={i === cat.products.length - 1 || moving === p.id}
                style={{ padding: "0 6px", fontSize: 10, lineHeight: "16px" }}
              >
                ▼
              </button>
            </div>
            <span>{p.name}</span>
          </div>
        ))}
        {cat.products.length === 0 && subcategories.length === 0 && (
          <div className="muted" style={{ fontSize: 12, marginLeft: 18 }}>
            Sin productos.
          </div>
        )}

        {subcategories.map((sub, si) => renderCategory(sub, subcategories, si, depth + 1))}
      </div>
    );
  }

  const topLevel = childrenOf(categories, null);

  return (
    <div
      style={{
        background: "var(--surface-solid)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
        boxShadow: "var(--shadow-card)",
        maxHeight: 420,
        overflowY: "auto",
      }}
    >
      <h4 style={{ marginTop: 0 }}>Orden del menú</h4>
      <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>
        Asi se muestran las categorias, subcategorias y productos cuando el bot manda el menu por WhatsApp.
      </p>
      {topLevel.map((cat, ci) => renderCategory(cat, topLevel, ci, 0))}
      {categories.length === 0 && <p className="muted">Aun no hay productos.</p>}
      {deleteError && <div className="error-text" style={{ marginTop: 8 }}>{deleteError}</div>}
    </div>
  );
}
