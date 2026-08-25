"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { ProductDTO } from "@pollos/shared";

const MAX_COMBO_ITEMS = 6;

interface ComboLine {
  productId: string;
  quantity: number;
}

function ComboSection({
  lines,
  setLines,
  allProducts,
}: {
  lines: ComboLine[];
  setLines: (lines: ComboLine[]) => void;
  allProducts: ProductDTO[];
}) {
  const [addProductId, setAddProductId] = useState(allProducts[0]?.id ?? "");

  function addLine() {
    if (lines.length >= MAX_COMBO_ITEMS) return;
    const product = allProducts.find((p) => p.id === addProductId);
    if (!product) return;
    const existing = lines.find((l) => l.productId === product.id);
    if (existing) {
      setLines(lines.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l)));
    } else {
      setLines([...lines, { productId: product.id, quantity: 1 }]);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, border: "1px solid var(--border)", borderRadius: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>Productos que incluye este combo (máximo {MAX_COMBO_ITEMS})</div>
      {lines.map((l) => {
        const product = allProducts.find((p) => p.id === l.productId);
        return (
          <div key={l.productId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="number"
              min={1}
              value={l.quantity}
              onChange={(e) =>
                setLines(lines.map((x) => (x.productId === l.productId ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))
              }
              style={{ width: 60 }}
            />
            <span style={{ flex: 1 }}>{product?.name ?? l.productId}</span>
            <button
              type="button"
              className="danger"
              onClick={() => setLines(lines.filter((x) => x.productId !== l.productId))}
              style={{ padding: "2px 8px", fontSize: 11 }}
            >
              Quitar
            </button>
          </div>
        );
      })}
      {lines.length < MAX_COMBO_ITEMS && (
        <div style={{ display: "flex", gap: 8 }}>
          <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} style={{ flex: 1 }}>
            {allProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.categoryName} — {p.name}
              </option>
            ))}
          </select>
          <button type="button" className="secondary" onClick={addLine}>
            + Agregar
          </button>
        </div>
      )}
    </div>
  );
}

export function ProductModal({
  mode,
  product,
  categories,
  allProducts,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  product?: ProductDTO;
  categories: Array<{ id: string; name: string }>;
  allProducts: ProductDTO[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [unitCount, setUnitCount] = useState(product?.unitCount ? String(product.unitCount) : "");
  const [searchKeywords, setSearchKeywords] = useState(product?.searchKeywords ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [isAvailable, setIsAvailable] = useState(product?.isAvailable ?? true);
  const [showInMenu, setShowInMenu] = useState(product?.showInMenu ?? true);
  const [isDefaultVariant, setIsDefaultVariant] = useState(product?.isDefaultVariant ?? false);
  const [comboLines, setComboLines] = useState<ComboLine[]>(
    product?.comboItems.map((i) => ({ productId: i.productId, quantity: i.quantity })) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteValue, setDeleteValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedCategoryName = categories.find((c) => c.id === categoryId)?.name ?? "";
  const isCombo = mode === "create" ? selectedCategoryName.toLowerCase().includes("combo") : (product?.isCombo ?? false);
  const otherProducts = allProducts.filter((p) => p.id !== product?.id);

  async function refreshAgent() {
    try {
      await apiClientFetch("/agent/refresh", { method: "POST" });
    } catch {
      // no bloquea el guardado si esto falla, el cache de todos modos vence solo
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        categoryId,
        name,
        price: Number(price),
        description: description.trim() || null,
        unitCount: unitCount.trim() ? Number(unitCount) : null,
        searchKeywords: searchKeywords.trim() || null,
        isAvailable,
        showInMenu,
        isDefaultVariant,
        ...(isCombo ? { isCombo: true, comboItems: comboLines } : {}),
      };

      if (mode === "create") {
        await apiClientFetch("/products", { method: "POST", body: JSON.stringify(payload) });
      } else if (product) {
        await apiClientFetch(`/products/${product.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      }

      await refreshAgent();
      router.refresh();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el producto");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!product || deleteValue.trim().toLowerCase() !== "confirmar") return;
    setDeleting(true);
    setError(null);
    try {
      await apiClientFetch(`/products/${product.id}`, { method: "DELETE" });
      await refreshAgent();
      router.refresh();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el producto");
      setDeleting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "94vw",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--surface-solid)",
          padding: 24,
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <h4 style={{ marginTop: 0 }}>{mode === "create" ? "Nuevo producto" : `Editar: ${product?.name}`}</h4>

        {!confirmingDelete ? (
          <form className="card-form" onSubmit={handleSubmit} style={{ padding: 0, border: "none", boxShadow: "none", gap: 12 }}>
            <label>
              Nombre
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Pollo Frito 6 piezas" required autoFocus />
            </label>

            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 1 }}>
                Categoría
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ flex: 1 }}>
                Estado
                <select value={isAvailable ? "1" : "0"} onChange={(e) => setIsAvailable(e.target.value === "1")}>
                  <option value="1">Activo</option>
                  <option value="0">Inactivo</option>
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 1 }}>
                Precio
                <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} required />
              </label>
              <label style={{ flex: 1 }}>
                Cantidad / piezas (opcional)
                <input type="number" min={1} value={unitCount} onChange={(e) => setUnitCount(e.target.value)} placeholder="Ej: 8" />
              </label>
            </div>

            <label>
              Palabras clave adicionales (opcional)
              <input
                value={searchKeywords}
                onChange={(e) => setSearchKeywords(e.target.value)}
                placeholder='Ej: "pollo entero"'
              />
            </label>

            <label>
              Descripción (opcional)
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </label>

            {isCombo && <ComboSection lines={comboLines} setLines={setComboLines} allProducts={otherProducts} />}

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={showInMenu} onChange={(e) => setShowInMenu(e.target.checked)} />
                Mostrar en el menú del bot
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={isDefaultVariant} onChange={(e) => setIsDefaultVariant(e.target.checked)} />
                Variante por defecto de su categoría
              </label>
            </div>

            {error && <div className="error-text">{error}</div>}

            <div style={{ display: "flex", gap: 12, justifyContent: "space-between", marginTop: 4 }}>
              <div>
                {mode === "edit" && (
                  <button type="button" className="danger" onClick={() => setConfirmingDelete(true)} disabled={saving}>
                    Eliminar
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="secondary" onClick={onClose} disabled={saving}>
                  Cancelar
                </button>
                <button type="submit" className="cta" disabled={saving || !name.trim() || !price}>
                  {saving ? "Guardando..." : mode === "create" ? "Crear producto" : "Guardar cambios"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              ¿Desea eliminar el producto <strong>"{product?.name}"</strong>? Esta acción no se puede deshacer. Escriba{" "}
              <strong>confirmar</strong> para continuar.
            </p>
            <input
              autoFocus
              value={deleteValue}
              onChange={(e) => setDeleteValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && deleteValue.trim().toLowerCase() === "confirmar" && !deleting && handleDelete()}
              placeholder="confirmar"
              disabled={deleting}
            />
            {error && <div className="error-text">{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="secondary" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                Cancelar
              </button>
              <button
                type="button"
                className="danger"
                disabled={deleteValue.trim().toLowerCase() !== "confirmar" || deleting}
                onClick={handleDelete}
              >
                {deleting ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
