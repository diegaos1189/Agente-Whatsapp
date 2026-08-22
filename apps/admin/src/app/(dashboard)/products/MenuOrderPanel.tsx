"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { CategoryDTO } from "@pollos/shared";

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

  async function moveCategory(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const current = categories[index];
    const target = categories[targetIndex];
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
        Asi se muestran los productos cuando el bot manda el menu por WhatsApp.
      </p>
      {categories.map((cat, ci) => (
        <div key={cat.id} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => moveCategory(ci, -1)}
                disabled={ci === 0 || moving === cat.id}
                style={{ padding: "0 6px", fontSize: 10, lineHeight: "16px" }}
              >
                ▲
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => moveCategory(ci, 1)}
                disabled={ci === categories.length - 1 || moving === cat.id}
                style={{ padding: "0 6px", fontSize: 10, lineHeight: "16px" }}
              >
                ▼
              </button>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", flex: 1 }}>
              {cat.name}
            </div>
            <button
              type="button"
              className="danger"
              onClick={() => deleteCategory(cat.id, cat.name)}
              disabled={cat.products.length > 0 || deleting === cat.id}
              title={cat.products.length > 0 ? "Esta categoría tiene productos asociados, muévelos o elimínalos primero" : "Eliminar categoría"}
              style={{ padding: "2px 8px", fontSize: 10 }}
            >
              {deleting === cat.id ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
          {cat.products.map((p, i) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "3px 0" }}>
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
          {cat.products.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Sin productos.</div>}
        </div>
      ))}
      {categories.length === 0 && <p className="muted">Aun no hay productos.</p>}
      {deleteError && <div className="error-text" style={{ marginTop: 8 }}>{deleteError}</div>}
    </div>
  );
}
