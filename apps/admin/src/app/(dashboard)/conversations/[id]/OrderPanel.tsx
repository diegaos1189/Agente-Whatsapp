"use client";

import { useEffect, useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { CategoryDTO, OrderDTO, PendingOrderDTO } from "@pollos/shared";

interface CartLine {
  productId: string;
  quantity: number;
  /** Nombre de respaldo para lineas precargadas del pedido de la IA, por si el producto no
   * esta (todavia) en `allProducts` cuando se pinta la primera vez. */
  fallbackName?: string;
}

// Fallback si el agente humano aun no agrego productos al carrito.
const ASK_ADDRESS_FALLBACK = "Perfecto, ¿cual es su direccion completa, barrio y un punto de referencia?";

export function OrderPanel({
  contactId,
  conversationId,
  pendingOrder,
}: {
  contactId: string;
  conversationId: string;
  pendingOrder: PendingOrderDTO | null;
}) {
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderDTO | null>(null);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [deliveryType, setDeliveryType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TRANSFER" | "CARD_ON_DELIVERY">("CASH");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [reference, setReference] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestingAddress, setRequestingAddress] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [prefilledFromAi, setPrefilledFromAi] = useState(false);
  const [savingPending, setSavingPending] = useState(false);
  const [selectedMain, setSelectedMain] = useState("");
  const [selectedSide, setSelectedSide] = useState("");
  const [selectedDrink, setSelectedDrink] = useState("");
  const [savedPending, setSavedPending] = useState(false);
  const [confirmingWithAi, setConfirmingWithAi] = useState(false);

  async function confirmPayment() {
    if (!order) return;
    setConfirmingPayment(true);
    try {
      await apiClientFetch(`/orders/${order.id}/confirm-payment`, { method: "POST" });
      await load();
    } finally {
      setConfirmingPayment(false);
    }
  }

  async function requestAddress() {
    setRequestingAddress(true);
    try {
      if (cart.length > 0) {
        await apiClientFetch(`/conversations/${conversationId}/request-address`, {
          method: "POST",
          body: JSON.stringify({ items: cart }),
        });
      } else {
        await apiClientFetch(`/conversations/${conversationId}/reply`, {
          method: "POST",
          body: JSON.stringify({ body: ASK_ADDRESS_FALLBACK }),
        });
      }
    } finally {
      setRequestingAddress(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const orders = await apiClientFetch<OrderDTO[]>(`/orders?contactId=${contactId}`);
      // El pedido mas reciente puede ser de un ciclo anterior ya cerrado (entregado o
      // cancelado, ej: de ayer) — en ese caso no es "el pedido de esta conversacion",
      // sino historial. Solo lo mostramos como pedido activo si sigue en curso.
      const activeOrder = orders.find((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED") ?? null;
      setOrder(activeOrder);
      if (!activeOrder) {
        const cats = await apiClientFetch<CategoryDTO[]>("/products");
        setCategories(cats);
        // Precarga el carrito con lo que la IA ya recopilo en la conversacion (antes de
        // confirmarlo) — asi el humano en handoff no arranca de cero, y puede editarlo.
        if (pendingOrder && pendingOrder.cart.length > 0) {
          // Consolida por productId (suma cantidades) — bug real: si quedaban varias lineas
          // sueltas con el mismo producto duplicado por el agente, "Quitar" borraba TODAS
          // las que compartian ese id de una vez, porque no habia forma de distinguirlas.
          const consolidated = new Map<string, CartLine>();
          for (const item of pendingOrder.cart) {
            const key = item.productId ?? `__sin_id__${item.productName}`;
            const existing = consolidated.get(key);
            if (existing) existing.quantity += item.quantity;
            else consolidated.set(key, { productId: item.productId ?? "", quantity: item.quantity, fallbackName: item.productName });
          }
          setCart([...consolidated.values()]);
          if (pendingOrder.deliveryType) setDeliveryType(pendingOrder.deliveryType);
          if (pendingOrder.paymentMethod) setPaymentMethod(pendingOrder.paymentMethod);
          if (pendingOrder.address) setAddress(pendingOrder.address);
          if (pendingOrder.neighborhood) setNeighborhood(pendingOrder.neighborhood);
          setPrefilledFromAi(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  function addLine(productId: string) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) return prev.map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { productId, quantity: 1 }];
    });
  }

  function removeLineAt(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  function setQuantityAt(index: number, quantity: number) {
    setCart((prev) => prev.map((l, i) => (i === index ? { ...l, quantity: Math.max(1, quantity) } : l)));
  }

  const allProducts = categories.flatMap((c) => c.products);
  const sideProducts = allProducts.filter((p) => /acompa/i.test(p.categoryName));
  const drinkProducts = allProducts.filter((p) => /bebida/i.test(p.categoryName));
  const mainProducts = allProducts.filter((p) => !/acompa/i.test(p.categoryName) && !/bebida/i.test(p.categoryName));

  function buildEditPayload() {
    return {
      items: cart
        .filter((l) => l.productId)
        .map((l) => {
          const product = allProducts.find((p) => p.id === l.productId);
          return {
            productId: l.productId,
            productName: product?.name ?? l.fallbackName ?? "Producto",
            quantity: l.quantity,
            unitPrice: product?.price ?? 0,
          };
        }),
      deliveryType,
      address: deliveryType === "DELIVERY" ? address : null,
      neighborhood: deliveryType === "DELIVERY" ? neighborhood : null,
      paymentMethod,
    };
  }

  async function handleSavePendingOrder() {
    setSavingPending(true);
    setError(null);
    try {
      await apiClientFetch(`/conversations/${conversationId}/save-pending-order`, {
        method: "POST",
        body: JSON.stringify(buildEditPayload()),
      });
      setSavedPending(true);
      setTimeout(() => setSavedPending(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el pedido");
    } finally {
      setSavingPending(false);
    }
  }

  async function handleConfirmWithAi() {
    setConfirmingWithAi(true);
    setError(null);
    try {
      await apiClientFetch(`/conversations/${conversationId}/confirm-pending-order`, {
        method: "POST",
        body: JSON.stringify(buildEditPayload()),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar el pedido con el cliente");
    } finally {
      setConfirmingWithAi(false);
    }
  }

  async function handleCreateOrder() {
    // Lineas sin productId (producto ya borrado del catalogo) no se pueden crear — se
    // ignoran en vez de fallar toda la creacion del pedido.
    const validItems = cart.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: l.quantity }));
    if (validItems.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      await apiClientFetch("/orders", {
        method: "POST",
        body: JSON.stringify({
          contactId,
          items: validItems,
          deliveryType,
          paymentMethod,
          address: deliveryType === "DELIVERY" ? address : null,
          neighborhood: deliveryType === "DELIVERY" ? neighborhood : null,
          reference: deliveryType === "DELIVERY" ? reference : null,
        }),
      });
      setCart([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el pedido");
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="muted">Cargando pedido...</div>;

  if (order) {
    return (
      <div style={{ background: "var(--surface-solid)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18, boxShadow: "var(--shadow-card)" }}>
        <h3>Pedido {order.code}</h3>
        <span className="badge status">{order.status}</span>
        {order.status === "AWAITING_PAYMENT" && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 8,
              background: "var(--warning-soft)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            ⏳ Verifique el comprobante de transferencia antes de confirmar.
            <button
              type="button"
              className="cta"
              disabled={confirmingPayment}
              onClick={confirmPayment}
              style={{ display: "block", marginTop: 8 }}
            >
              {confirmingPayment ? "Confirmando..." : "Pago confirmado"}
            </button>
          </div>
        )}
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          {order.items.map((i) => (
            <div key={i.id} className="muted" style={{ fontSize: 13 }}>
              {i.quantity}x {i.productName}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, fontWeight: 600 }}>
          Total: {new Intl.NumberFormat("es-419", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(order.total)}
        </div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          {order.deliveryType === "DELIVERY" ? `Domicilio: ${order.address ?? "-"}` : "Recoge en el local"}
        </div>
        {order.contactPhone && order.contactPhone !== order.phone && (
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            📞 Contacto para el domiciliario: {order.contactPhone}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: "var(--surface-solid)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18, boxShadow: "var(--shadow-card)" }}>
      <h3>Sin pedido</h3>
      {prefilledFromAi ? (
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Precargado con lo que el agente ya recopilo en la conversacion — revisalo, corrigelo si hace falta y crea el pedido.
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>Este cliente no tiene un pedido. Crea uno manual:</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        {[
          { label: "Platos fuertes", products: mainProducts, value: selectedMain, setValue: setSelectedMain },
          { label: "Acompañantes", products: sideProducts, value: selectedSide, setValue: setSelectedSide },
          { label: "Bebidas", products: drinkProducts, value: selectedDrink, setValue: setSelectedDrink },
        ].map(({ label, products, value, setValue }) =>
          products.length === 0 ? null : (
            <div key={label}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={value || products[0]!.id} onChange={(e) => setValue(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => addLine(value || products[0]!.id)}
                  style={{ flexShrink: 0, whiteSpace: "nowrap", fontSize: 13, padding: "8px 12px" }}
                >
                  + Agregar
                </button>
              </div>
            </div>
          ),
        )}
      </div>

      {cart.length > 0 && (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          {cart.map((line, i) => {
            const product = allProducts.find((p) => p.id === line.productId);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{product?.name ?? line.fallbackName ?? "Producto"}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setQuantityAt(i, line.quantity - 1)}
                    style={{ padding: "2px 8px", fontSize: 11 }}
                  >
                    −
                  </button>
                  <span style={{ minWidth: 18, textAlign: "center" }}>{line.quantity}</span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setQuantityAt(i, line.quantity + 1)}
                    style={{ padding: "2px 8px", fontSize: 11 }}
                  >
                    +
                  </button>
                </div>
                <button type="button" className="danger" onClick={() => removeLineAt(i)} style={{ padding: "2px 8px", fontSize: 11 }}>
                  Quitar
                </button>
              </div>
            );
          })}
        </div>
      )}

      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Entrega</label>
      <select value={deliveryType} onChange={(e) => setDeliveryType(e.target.value as "PICKUP" | "DELIVERY")} style={{ marginBottom: 10, width: "100%" }}>
        <option value="PICKUP">Recoger en el local</option>
        <option value="DELIVERY">Domicilio</option>
      </select>

      {deliveryType === "DELIVERY" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          <input placeholder="Dirección" value={address} onChange={(e) => setAddress(e.target.value)} />
          <input placeholder="Barrio" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
          <input placeholder="Referencia" value={reference} onChange={(e) => setReference(e.target.value)} />
          <button type="button" className="secondary" disabled={requestingAddress} onClick={requestAddress} style={{ fontSize: 12 }}>
            {requestingAddress ? "Enviando..." : "Solicitar dirección al cliente"}
          </button>
        </div>
      )}

      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Método de pago</label>
      <select
        value={paymentMethod}
        onChange={(e) => setPaymentMethod(e.target.value as "CASH" | "TRANSFER" | "CARD_ON_DELIVERY")}
        style={{ marginBottom: 12, width: "100%" }}
      >
        <option value="CASH">Efectivo</option>
        <option value="TRANSFER">Transferencia</option>
        <option value="CARD_ON_DELIVERY">Tarjeta contraentrega</option>
      </select>

      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="secondary"
          onClick={handleSavePendingOrder}
          disabled={savingPending || cart.length === 0}
          style={{ flex: 1 }}
        >
          {savingPending ? "Guardando..." : "Guardar"}
        </button>
        <button
          type="button"
          className="cta"
          onClick={handleConfirmWithAi}
          disabled={confirmingWithAi || cart.length === 0}
          style={{ flex: 1 }}
        >
          {confirmingWithAi ? "Enviando..." : "Confirmar con el cliente (IA)"}
        </button>
      </div>
      {savedPending && <div className="save-success" style={{ marginBottom: 8, fontSize: 12 }}>✓ Pedido guardado</div>}
      <p className="muted" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
        "Guardar" actualiza el pedido sin avisarle al cliente. "Confirmar con el cliente" le manda el resumen y le
        pide que confirme — al decir "sí" se crea el pedido solo.
      </p>

      <button type="button" className="cta" onClick={handleCreateOrder} disabled={creating || cart.length === 0} style={{ width: "100%" }}>
        {creating ? "Creando..." : "Crear pedido directamente (sin pedirle confirmación)"}
      </button>
    </div>
  );
}
