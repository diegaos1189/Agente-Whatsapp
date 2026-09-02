import Link from "next/link";
import { apiServerFetchScoped } from "@/lib/apiServer";
import type { BusinessSettingsDTO, CategoryDTO, OrderDTO, ProductDTO } from "@pollos/shared";
import { OrderRow } from "./OrderRow";
import { AlertQuickActions } from "./AlertQuickActions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SearchBox } from "@/components/SearchBox";

const ARCHIVED_LIMIT = 10;
const ALERT_PREVIEW_LIMIT = 6;

type OrderView = "all" | "risk" | "awaiting_payment" | "ready" | "on_the_way" | "new";

interface OrderOperationalAlertView {
  orderId: string;
  orderCode: string;
  customerName: string | null;
  phone: string;
  status: OrderDTO["status"];
  deliveryType: OrderDTO["deliveryType"];
  flaggedForReview: boolean;
  reason: "AWAITING_PAYMENT_STALE" | "RECEIVED_STALE" | "READY_FOR_PICKUP_STALE" | "READY_FOR_DISPATCH_STALE";
  note: string;
  delayMinutes: number;
  suggestedAction: string;
  createdAt: string;
  updatedAt: string;
}

const ALERT_REASON_LABELS: Record<OrderOperationalAlertView["reason"], string> = {
  AWAITING_PAYMENT_STALE: "Pago pendiente",
  RECEIVED_STALE: "Retraso en cocina",
  READY_FOR_PICKUP_STALE: "Listo sin recoger",
  READY_FOR_DISPATCH_STALE: "Listo sin despacho",
};

function getOrderPriority(order: OrderDTO): number {
  if (order.flaggedForReview) return 0;
  if (order.status === "AWAITING_PAYMENT") return 1;
  if (order.status === "READY") return 2;
  if (order.status === "RECEIVED") return 3;
  if (order.status === "ON_THE_WAY") return 4;
  return 5;
}

function matchesView(order: OrderDTO, view: OrderView): boolean {
  switch (view) {
    case "risk":
      return order.flaggedForReview;
    case "awaiting_payment":
      return order.status === "AWAITING_PAYMENT";
    case "ready":
      return order.status === "READY";
    case "on_the_way":
      return order.status === "ON_THE_WAY";
    case "new":
      return order.status === "RECEIVED";
    default:
      return true;
  }
}

function OrdersGrid({
  orders,
  settings,
  products,
  emptyLabel,
}: {
  orders: OrderDTO[];
  settings: BusinessSettingsDTO;
  products: ProductDTO[];
  emptyLabel: string;
}) {
  if (orders.length === 0) return <p className="muted">{emptyLabel}</p>;
  return (
    <div className="order-grid">
      {orders.map((order) => (
        <OrderRow
          key={order.id}
          order={order}
          currency={settings.currency}
          thresholdMinutes={settings.estimatedPrepMinutes}
          products={products}
        />
      ))}
    </div>
  );
}

function buildFilterHref(params: { q?: string; view: OrderView }) {
  const search = new URLSearchParams();
  if (params.q?.trim()) search.set("q", params.q.trim());
  if (params.view !== "all") search.set("view", params.view);
  const query = search.toString();
  return query ? `/orders?${query}` : "/orders";
}

export async function OrdersView({
  restaurantId,
  basePath = "",
  searchParams,
}: {
  /** Restaurante del panel abierto. Sin valor = el restaurante de este deployment. */
  restaurantId?: string;
  /** Prefijo de los links internos: "" en la raiz, "/<slug>" en el panel de un cliente. */
  basePath?: string;
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const { q, view } = await searchParams;
  const [orders, settings, categories, alerts] = await Promise.all([
    apiServerFetchScoped<OrderDTO[]>("/api/orders", restaurantId),
    apiServerFetchScoped<BusinessSettingsDTO>("/api/settings", restaurantId),
    apiServerFetchScoped<CategoryDTO[]>("/api/products", restaurantId),
    apiServerFetchScoped<OrderOperationalAlertView[]>("/api/orders/alerts", restaurantId),
  ]);

  const products = categories.flatMap((category) => category.products);
  const activeView: OrderView =
    view === "risk" || view === "awaiting_payment" || view === "ready" || view === "on_the_way" || view === "new" ? view : "all";

  const query = q?.trim().toLowerCase();
  const filtered = query
    ? orders.filter(
        (order) =>
          order.code.toLowerCase().includes(query) ||
          (order.customerName ?? "").toLowerCase().includes(query) ||
          order.phone.includes(query),
      )
    : orders;

  const activeOrders = filtered
    .filter((order) => order.status !== "DELIVERED" && order.status !== "CANCELLED")
    .sort((a, b) => {
      const priorityDiff = getOrderPriority(a) - getOrderPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  const visibleActive = activeOrders.filter((order) => matchesView(order, activeView));
  const archived = filtered
    .filter((order) => order.status === "DELIVERED")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, ARCHIVED_LIMIT);

  const counts = {
    all: activeOrders.length,
    risk: activeOrders.filter((order) => order.flaggedForReview).length,
    awaiting_payment: activeOrders.filter((order) => order.status === "AWAITING_PAYMENT").length,
    ready: activeOrders.filter((order) => order.status === "READY").length,
    on_the_way: activeOrders.filter((order) => order.status === "ON_THE_WAY").length,
    new: activeOrders.filter((order) => order.status === "RECEIVED").length,
  };

  const filters: Array<{ key: OrderView; label: string; count: number }> = [
    { key: "all", label: "Todos", count: counts.all },
    { key: "risk", label: "En riesgo", count: counts.risk },
    { key: "awaiting_payment", label: "Esperando pago", count: counts.awaiting_payment },
    { key: "ready", label: "Listos", count: counts.ready },
    { key: "on_the_way", label: "En camino", count: counts.on_the_way },
    { key: "new", label: "Nuevos", count: counts.new },
  ];

  const alertPreview = alerts.slice(0, ALERT_PREVIEW_LIMIT);

  return (
    <div>
      <AutoRefresh intervalMs={8000} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Panel operativo de pedidos</h2>
          <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
            Prioriza pagos pendientes, pedidos en riesgo y estados listos para despacho o recogida.
          </p>
        </div>
        <SearchBox placeholder="Buscar por codigo, cliente o telefono..." />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16, marginBottom: 18 }}>
        {filters.map((filter) => {
          const selected = activeView === filter.key;
          return (
            <Link
              key={filter.key}
              href={buildFilterHref({ q, view: filter.key })}
              style={{
                textDecoration: "none",
                padding: "10px 12px",
                borderRadius: 14,
                border: selected ? "1px solid var(--danger)" : "1px solid var(--border)",
                background: selected ? "var(--danger-soft)" : "var(--surface-solid)",
                color: selected ? "var(--danger)" : "var(--text)",
                minWidth: 128,
              }}
            >
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.8 }}>{filter.label}</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: 4 }}>{filter.count}</div>
            </Link>
          );
        })}
      </div>

      <div
        style={{
          marginBottom: 18,
          padding: 16,
          borderRadius: 18,
          border: "1px solid var(--border)",
          background: "linear-gradient(135deg, rgba(255,149,0,0.12), rgba(255,59,48,0.08))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Alertas activas</h3>
            <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>
              Vista en tiempo real al 23 de agosto de 2026 para priorizar caja, cocina y despacho.
            </p>
          </div>
          <Link
            href={buildFilterHref({ q, view: "risk" })}
            style={{
              textDecoration: "none",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid var(--danger)",
              color: "var(--danger)",
              background: "var(--danger-soft)",
              fontWeight: 700,
            }}
          >
            Ver pedidos en riesgo ({alerts.length})
          </Link>
        </div>

        {alertPreview.length === 0 ? (
          <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
            No hay alertas activas ahora mismo.
          </p>
        ) : (
          <div className="report-grid" style={{ marginTop: 14 }}>
            {alertPreview.map((alert) => (
              <div key={`${alert.orderId}:${alert.reason}`} className="report-card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div className="pill pill-warning">{ALERT_REASON_LABELS[alert.reason]}</div>
                  <div className="report-card-value" style={{ fontSize: "1.1rem" }}>
                    +{alert.delayMinutes} min
                  </div>
                </div>
                <div style={{ marginTop: 10, fontWeight: 700 }}>{alert.orderCode}</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {(alert.customerName ?? "Cliente sin nombre")} - {alert.phone}
                </div>
                <div style={{ marginTop: 8 }}>{alert.note}</div>
                <div className="muted" style={{ marginTop: 8, fontSize: "0.78rem" }}>
                  Siguiente accion: {alert.suggestedAction}
                </div>
                <AlertQuickActions
                  orderId={alert.orderId}
                  status={alert.status}
                  deliveryType={alert.deliveryType}
                  flaggedForReview={alert.flaggedForReview}
                />
                <div style={{ marginTop: 12 }}>
                  <Link
                    href={buildFilterHref({ q: alert.orderCode, view: "all" })}
                    style={{ textDecoration: "none", color: "var(--accent)", fontWeight: 700 }}
                  >
                    Abrir pedido
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <p className="muted" style={{ margin: 0 }}>
          {activeView === "all"
            ? "Ordenados por prioridad operativa: riesgo, pago pendiente, listos, nuevos y en camino."
            : `Vista filtrada: ${filters.find((filter) => filter.key === activeView)?.label ?? "Pedidos"}.`}
        </p>
      </div>

      <OrdersGrid
        orders={visibleActive}
        settings={settings}
        products={products}
        emptyLabel="No hay pedidos en esta vista operativa."
      />

      <h2 style={{ marginTop: "2rem" }}>Archivados (ultimos {ARCHIVED_LIMIT} entregados)</h2>
      <OrdersGrid orders={archived} settings={settings} products={products} emptyLabel="Aun no hay pedidos entregados." />
    </div>
  );
}
