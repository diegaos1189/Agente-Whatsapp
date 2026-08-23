import Link from "next/link";
import { apiServerFetch } from "@/lib/apiServer";
import type { BusinessSettingsDTO, CategoryDTO, OrderDTO, ProductDTO } from "@pollos/shared";
import { OrderRow } from "./OrderRow";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SearchBox } from "@/components/SearchBox";

const ARCHIVED_LIMIT = 10;

type OrderView = "all" | "risk" | "awaiting_payment" | "ready" | "on_the_way" | "new";

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
      {orders.map((o) => (
        <OrderRow key={o.id} order={o} currency={settings.currency} thresholdMinutes={settings.estimatedPrepMinutes} products={products} />
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

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const { q, view } = await searchParams;
  const [orders, settings, categories] = await Promise.all([
    apiServerFetch<OrderDTO[]>("/api/orders"),
    apiServerFetch<BusinessSettingsDTO>("/api/settings"),
    apiServerFetch<CategoryDTO[]>("/api/products"),
  ]);
  const products = categories.flatMap((c) => c.products);
  const activeView: OrderView =
    view === "risk" || view === "awaiting_payment" || view === "ready" || view === "on_the_way" || view === "new" ? view : "all";

  const query = q?.trim().toLowerCase();
  const filtered = query
    ? orders.filter(
        (o) =>
          o.code.toLowerCase().includes(query) ||
          (o.customerName ?? "").toLowerCase().includes(query) ||
          o.phone.includes(query),
      )
    : orders;

  const activeOrders = filtered
    .filter((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED")
    .sort((a, b) => {
      const priorityDiff = getOrderPriority(a) - getOrderPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  const visibleActive = activeOrders.filter((order) => matchesView(order, activeView));
  const archived = filtered
    .filter((o) => o.status === "DELIVERED")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, ARCHIVED_LIMIT);

  const counts = {
    all: activeOrders.length,
    risk: activeOrders.filter((o) => o.flaggedForReview).length,
    awaiting_payment: activeOrders.filter((o) => o.status === "AWAITING_PAYMENT").length,
    ready: activeOrders.filter((o) => o.status === "READY").length,
    on_the_way: activeOrders.filter((o) => o.status === "ON_THE_WAY").length,
    new: activeOrders.filter((o) => o.status === "RECEIVED").length,
  };

  const filters: Array<{ key: OrderView; label: string; count: number }> = [
    { key: "all", label: "Todos", count: counts.all },
    { key: "risk", label: "En riesgo", count: counts.risk },
    { key: "awaiting_payment", label: "Esperando pago", count: counts.awaiting_payment },
    { key: "ready", label: "Listos", count: counts.ready },
    { key: "on_the_way", label: "En camino", count: counts.on_the_way },
    { key: "new", label: "Nuevos", count: counts.new },
  ];

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
