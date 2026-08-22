"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { PromotionDTO, ProductDTO } from "@pollos/shared";
import { DaysOfWeekPicker } from "./DaysOfWeekPicker";
import { formatDaysOfWeek } from "./dayLabels";

type DiscountType = "" | "PERCENTAGE" | "FIXED_AMOUNT";

export function PromotionRow({ promotion, products }: { promotion: PromotionDTO; products: ProductDTO[] }) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(promotion.isActive);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(promotion.title);
  const [description, setDescription] = useState(promotion.description);
  const [productId, setProductId] = useState(promotion.productId ?? "");
  const [discountType, setDiscountType] = useState<DiscountType>(promotion.discountType ?? "");
  const [discountValue, setDiscountValue] = useState(promotion.discountValue?.toString() ?? "");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(promotion.daysOfWeek);
  const [saving, setSaving] = useState(false);

  async function toggle(checked: boolean) {
    setIsActive(checked);
    setSaving(true);
    try {
      await apiClientFetch(`/promotions/${promotion.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: checked }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    setSaving(true);
    try {
      await apiClientFetch(`/promotions/${promotion.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          description,
          productId: productId || null,
          discountType: discountType || null,
          discountValue: discountType && discountValue ? Number(discountValue) : null,
          daysOfWeek,
        }),
      });
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setTitle(promotion.title);
    setDescription(promotion.description);
    setProductId(promotion.productId ?? "");
    setDiscountType(promotion.discountType ?? "");
    setDiscountValue(promotion.discountValue?.toString() ?? "");
    setDaysOfWeek(promotion.daysOfWeek);
    setEditing(false);
  }

  async function remove() {
    if (!confirm(`¿Eliminar la promoción "${promotion.title}"?`)) return;
    setSaving(true);
    try {
      await apiClientFetch(`/promotions/${promotion.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={6}>
          <div style={{ padding: "12px 4px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={{ flex: "1 1 200px" }}>
                Título
                <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />
              </label>
              <label style={{ flex: "2 1 300px" }}>
                Descripción
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ width: "100%", resize: "vertical" }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ flex: "1 1 240px" }}>
                Producto (opcional)
                <select value={productId} onChange={(e) => setProductId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">Ninguno / general</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.categoryName} — {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {productId && (
                <>
                  <label style={{ flex: "1 1 160px" }}>
                    Tipo de descuento
                    <select value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)} style={{ width: "100%" }}>
                      <option value="">Sin descuento</option>
                      <option value="PERCENTAGE">% descuento</option>
                      <option value="FIXED_AMOUNT">Monto fijo</option>
                    </select>
                  </label>
                  {discountType && (
                    <label style={{ flex: "0 1 120px" }}>
                      {discountType === "PERCENTAGE" ? "% descuento" : "Monto"}
                      <input
                        type="number"
                        min={0}
                        max={discountType === "PERCENTAGE" ? 100 : undefined}
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        style={{ width: "100%" }}
                      />
                    </label>
                  )}
                </>
              )}
            </div>
            <DaysOfWeekPicker value={daysOfWeek} onChange={setDaysOfWeek} />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={saving || !title.trim() || !description.trim()} onClick={saveEdit}>
                Guardar
              </button>
              <button type="button" className="secondary" disabled={saving} onClick={cancelEdit}>
                Cancelar
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td style={{ minWidth: 140 }}>{promotion.title}</td>
      <td className="muted" style={{ minWidth: 260 }}>
        {promotion.description}
      </td>
      <td className="muted" style={{ minWidth: 160 }}>
        {promotion.productName ? (
          <>
            {promotion.productName}
            {promotion.discountType && promotion.discountValue != null && (
              <div>
                {promotion.discountType === "PERCENTAGE" ? `-${promotion.discountValue}%` : `-${promotion.discountValue}`}
              </div>
            )}
          </>
        ) : (
          "-"
        )}
      </td>
      <td className="muted" style={{ fontSize: "0.8125rem" }}>
        {formatDaysOfWeek(promotion.daysOfWeek)}
      </td>
      <td>
        <input type="checkbox" checked={isActive} onChange={(e) => toggle(e.target.checked)} disabled={saving} />
      </td>
      <td>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="secondary" disabled={saving} onClick={() => setEditing(true)}>
            Editar
          </button>
          <button type="button" className="danger" disabled={saving} onClick={remove}>
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  );
}
