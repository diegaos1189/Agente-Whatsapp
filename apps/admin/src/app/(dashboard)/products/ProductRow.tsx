"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { ProductDTO } from "@pollos/shared";

export function ProductRow({ product, onEdit }: { product: ProductDTO; onEdit: () => void }) {
  const router = useRouter();
  const [toggling, setToggling] = useState(false);

  async function toggleAvailable() {
    setToggling(true);
    try {
      await apiClientFetch(`/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ isAvailable: !product.isAvailable }) });
      router.refresh();
    } finally {
      setToggling(false);
    }
  }

  return (
    <tr>
      <td>
        <strong>{product.name}</strong>
        {product.isCombo && product.comboItems.length > 0 && (
          <div className="muted" style={{ fontSize: 11 }}>
            {product.comboItems.map((i) => `${i.quantity}x ${i.productName}`).join(", ")}
          </div>
        )}
      </td>
      <td>{product.categoryName}</td>
      <td>{product.price}</td>
      <td>{product.unitCount ?? <span className="muted">-</span>}</td>
      <td>
        <span className={`pill ${product.isAvailable ? "pill-success" : "pill-neutral"}`}>
          {product.isAvailable ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="secondary" onClick={onEdit}>
            Editar
          </button>
          <button type="button" className="danger" disabled={toggling} onClick={toggleAvailable}>
            {product.isAvailable ? "Desactivar" : "Activar"}
          </button>
        </div>
      </td>
    </tr>
  );
}
