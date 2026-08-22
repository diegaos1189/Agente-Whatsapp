"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { ProductDTO } from "@pollos/shared";
import { DaysOfWeekPicker } from "./DaysOfWeekPicker";

type DiscountType = "" | "PERCENTAGE" | "FIXED_AMOUNT";

export function AddPromotionForm({ products }: { products: ProductDTO[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [productId, setProductId] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("");
  const [discountValue, setDiscountValue] = useState("");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClientFetch("/promotions", {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          isActive: true,
          productId: productId || null,
          discountType: discountType || null,
          discountValue: discountType && discountValue ? Number(discountValue) : null,
          daysOfWeek,
        }),
      });
      setTitle("");
      setDescription("");
      setProductId("");
      setDiscountType("");
      setDiscountValue("");
      setDaysOfWeek([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando promoción");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card-form" onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
      <h4>Nueva promoción</h4>
      <label>
        Título
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Miércoles de Combo" required />
      </label>
      <label>
        Descripción
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ej: 10% de descuento en el Combo Familiar los miércoles"
          required
        />
      </label>
      <label>
        Producto (opcional)
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Ninguno / promoción general</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.categoryName} — {p.name}
            </option>
          ))}
        </select>
      </label>
      {productId && (
        <div style={{ display: "flex", gap: 10 }}>
          <label style={{ flex: 1 }}>
            Tipo de descuento
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
              <option value="">Sin descuento</option>
              <option value="PERCENTAGE">Porcentaje (%)</option>
              <option value="FIXED_AMOUNT">Monto fijo</option>
            </select>
          </label>
          {discountType && (
            <label style={{ flex: 1 }}>
              {discountType === "PERCENTAGE" ? "% de descuento" : "Monto de descuento"}
              <input
                type="number"
                min={0}
                max={discountType === "PERCENTAGE" ? 100 : undefined}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
              />
            </label>
          )}
        </div>
      )}
      <DaysOfWeekPicker value={daysOfWeek} onChange={setDaysOfWeek} />
      {error && <div className="error-text">{error}</div>}
      <button type="submit" className="cta" disabled={saving || !title.trim() || !description.trim()}>
        {saving ? "Creando..." : "Crear promoción"}
      </button>
    </form>
  );
}
