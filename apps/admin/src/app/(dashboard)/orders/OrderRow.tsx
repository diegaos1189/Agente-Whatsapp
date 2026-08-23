"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { OrderDTO, ProductDTO } from "@pollos/shared";
import { OrderStatusSelect } from "./OrderStatusSelect";
import { OrderTimer } from "./OrderTimer";

interface EditLine {
  productId: string;
  productName: string;
  quantity: number;
}

const STATUS_PILL_CLASS: Record<string, string> = {
  RECEIVED: "pill-info",
  READY: "pill-success",
  ON_THE_WAY: "pill-info",
  DELIVERED: "pill-neutral",
  CANCELLED: "pill-danger",
  AWAITING_PAYMENT: "pill-warning",
};

function getOperationalBadge(order: OrderDTO): { label: string; color: string; background: string } | null {
  const note = (order.flagNote ?? "").toLowerCase();

  if (order.status === "AWAITING_PAYMENT") {
    return { label: "Pago pendiente", color: "#9a6700", background: "var(--warning-soft)" };
  }
  if (note.includes("confirmacion de pago")) {
    return { label: "Transferencia estancada", color: "var(--danger)", background: "var(--danger-soft)" };
  }
  if (note.includes("preparacion")) {
    return { label: "Retraso en cocina", color: "var(--danger)", background: "var(--danger-soft)" };
  }
  if (note.includes("despacho")) {
    return { label: "Esperando despacho", color: "var(--danger)", background: "var(--danger-soft)" };
  }
  if (note.includes("recoger")) {
    return { label: "Listo para recoger", color: "#9a6700", background: "var(--warning-soft)" };
  }
  if (order.flaggedForReview) {
    return { label: "Revisar pedido", color: "var(--danger)", background: "var(--danger-soft)" };
  }
  return null;
}

function OrderEditForm({
  order,
  products,
  onCancel,
  onSaved,
}: {
  order: OrderDTO;
  products: ProductDTO[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<EditLine[]>(
    order.items
      .filter((i): i is typeof i & { productId: string } => i.productId !== null)
      .map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })),
  );
  const [addProductId, setAddProductId] = useState(products[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addLine() {
    const product = products.find((p) => p.id === addProductId);
    if (!product) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) return prev.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { productId: product.id, productName: product.name, quantity: 1 }];
    });
  }

  function setQuantity(productId: string, quantity: number) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity } : l)));
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }

  async function save() {
    if (lines.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await apiClientFetch(`/orders/${order.id}/items`, {
        method: "PATCH",
        body: JSON.stringify({ items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo corregir el pedido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "10px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
      {lines.map((l) => (
        <div key={l.productId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8125rem" }}>
          <input
            type="number"
            min={1}
            value={l.quantity}
            onChange={(e) => setQuantity(l.productId, Math.max(1, Number(e.target.value)))}
            style={{ width: 60 }}
          />
          <span style={{ flex: 1 }}>{l.productName}</span>
          <button type="button" className="danger" onClick={() => removeLine(l.productId)} style={{ padding: "2px 8px", fontSize: "0.6875rem" }}>
            Quitar
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} style={{ flex: 1 }}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.categoryName} - {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={addLine}>
          + Agregar
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={saving || lines.length === 0} onClick={save}>
          {saving ? "Guardando..." : "Guardar correccion y avisar al cliente"}
        </button>
        <button type="button" className="secondary" disabled={saving} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function OrderRow({
  order,
  currency,
  thresholdMinutes,
  products,
}: {
  order: OrderDTO;
  currency: string;
  thresholdMinutes: number;
  products: ProductDTO[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const awaitingPayment = order.status === "AWAITING_PAYMENT";
  const operationalBadge = getOperationalBadge(order);

  async function dismissFlag() {
    setClearing(true);
    try {
      await apiClientFetch(`/orders/${order.id}/clear-flag`, { method: "POST" });
      router.refresh();
    } finally {
      setClearing(false);
    }
  }

  async function confirmPayment() {
    setConfirmingPayment(true);
    try {
      await apiClientFetch(`/orders/${order.id}/confirm-payment`, { method: "POST" });
      router.refresh();
    } finally {
      setConfirmingPayment(false);
    }
  }

  return (
    <div
      className="order-card"
      style={
        order.flaggedForReview
          ? { borderColor: "var(--danger)", boxShadow: "0 0 0 1px var(--danger-soft), var(--shadow-card)" }
          : awaitingPayment
            ? { borderColor: "#ff9500" }
            : undefined
      }
    >
      <div className="order-card-top">
        <div>
          <div className="order-card-code">{order.code}</div>
          <div className="order-card-customer">
            {order.customerName ?? "Cliente"} <span className="muted">· {order.phone}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {awaitingPayment ? (
            <span className="pill pill-warning">Esperando pago</span>
          ) : (
            <span className={`pill ${STATUS_PILL_CLASS[order.status] ?? "pill-neutral"}`}>{order.status}</span>
          )}
          {operationalBadge && (
            <span
              style={{
                background: operationalBadge.background,
                color: operationalBadge.color,
                borderRadius: 999,
                padding: "4px 8px",
                fontSize: "0.6875rem",
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              {operationalBadge.label}
            </span>
          )}
        </div>
      </div>

      <div className="order-card-stats">
        <div>
          <div className="order-card-stat-label">Total</div>
          <div className="order-card-stat-value">
            {new Intl.NumberFormat("es-419", { style: "currency", currency, maximumFractionDigits: 0 }).format(order.total)}
          </div>
        </div>
        <div>
          <div className="order-card-stat-label">Entrega</div>
          <div className="order-card-stat-value">{order.deliveryType === "DELIVERY" ? "Domicilio" : "Recoger"}</div>
        </div>
        <div>
          <div className="order-card-stat-label">Pago</div>
          <div className="order-card-stat-value">
            {order.paymentMethod ?? "-"} <span className="muted">({order.paymentStatus})</span>
          </div>
        </div>
        <div>
          <div className="order-card-stat-label">Tiempo</div>
          <div className="order-card-stat-value">
            <OrderTimer
              createdAt={order.createdAt}
              status={order.status}
              thresholdMinutes={thresholdMinutes}
              dispatchMinutes={order.dispatchMinutes}
            />
          </div>
        </div>
      </div>

      {!awaitingPayment && (
        <div>
          <OrderStatusSelect orderId={order.id} status={order.status} deliveryType={order.deliveryType} />
        </div>
      )}

      {order.flaggedForReview && (
        <div className="order-card-alert" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          <strong style={{ display: "block", marginBottom: 4 }}>Atencion operativa</strong>
          {order.flagNote ?? "El pedido necesita revision del equipo."}
          <button type="button" className="secondary" disabled={clearing} onClick={dismissFlag} style={{ marginLeft: 8, fontWeight: 400 }}>
            {clearing ? "Limpiando..." : "Ya revise"}
          </button>
        </div>
      )}

      {awaitingPayment && (
        <div className="order-card-alert" style={{ background: "var(--warning-soft)" }}>
          <strong style={{ display: "block", marginBottom: 4 }}>Pendiente de validar</strong>
          Pago por transferencia: confirme que la plata realmente llego antes de pasarlo a preparacion.
          <button type="button" disabled={confirmingPayment} onClick={confirmPayment} style={{ marginLeft: 8, fontWeight: 600 }}>
            {confirmingPayment ? "Confirmando..." : "Pago confirmado"}
          </button>
        </div>
      )}

      {editing && (
        <OrderEditForm
          order={order}
          products={products}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}

      <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid var(--border)" }}>
        {order.items.map((i) => (
          <div key={i.id} style={{ fontSize: "0.8125rem" }}>
            {i.quantity}x {i.productName}
            {i.notes ? <span className="muted"> ({i.notes})</span> : null}
          </div>
        ))}
        <div className="muted" style={{ fontSize: "0.75rem", marginTop: 4 }}>
          {order.deliveryType === "DELIVERY"
            ? `Domicilio: ${order.address ?? "-"}${order.neighborhood ? `, ${order.neighborhood}` : ""}${order.reference ? ` (${order.reference})` : ""}`
            : "Recoge en el local"}
        </div>
        {order.contactPhone && order.contactPhone !== order.phone && (
          <div className="muted" style={{ fontSize: "0.75rem" }}>
            Contacto para el domiciliario: {order.contactPhone}
          </div>
        )}
      </div>

      <div className="order-card-footer">
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          {new Date(order.createdAt).toLocaleString("es-419")}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {order.status !== "DELIVERED" && order.status !== "CANCELLED" && (
            <button type="button" className="secondary" onClick={() => setEditing((v) => !v)}>
              {editing ? "Cancelar" : "Corregir"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
