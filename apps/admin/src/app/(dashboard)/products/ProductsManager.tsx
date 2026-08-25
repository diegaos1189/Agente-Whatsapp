"use client";

import { useState } from "react";
import type { CategoryDTO, ProductDTO } from "@pollos/shared";
import { ProductRow } from "./ProductRow";
import { ProductModal } from "./ProductModal";

export function ProductsManager({ categories, allProducts }: { categories: CategoryDTO[]; allProducts: ProductDTO[] }) {
  const [tab, setTab] = useState<string>("ALL");
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; product: ProductDTO } | null>(null);

  const visibleProducts = tab === "ALL" ? allProducts : allProducts.filter((p) => p.categoryId === tab);
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        {categories.length > 1 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className={tab === "ALL" ? "cta" : "secondary"} onClick={() => setTab("ALL")}>
              Todos
            </button>
            {categories.map((c) => (
              <button type="button" key={c.id} className={tab === c.id ? "cta" : "secondary"} onClick={() => setTab(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="cta" onClick={() => setModal({ mode: "create" })} disabled={categories.length === 0}>
          + Nuevo producto
        </button>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Cantidad</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((p) => (
              <ProductRow key={p.id} product={p} onEdit={() => setModal({ mode: "edit", product: p })} />
            ))}
            {visibleProducts.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Sin productos en esta vista.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {categories.length === 0 && <p className="muted">Aún no hay categorías. Crea la primera arriba.</p>}

      {modal && (
        <ProductModal
          mode={modal.mode}
          product={modal.mode === "edit" ? modal.product : undefined}
          categories={categoryOptions}
          allProducts={allProducts}
          onClose={() => setModal(null)}
          onSaved={() => setModal(null)}
        />
      )}
    </div>
  );
}
