import { apiServerFetch } from "@/lib/apiServer";
import type { BusinessSettingsDTO, CategoryDTO, OrderDTO, ProductDTO } from "@pollos/shared";
import { OrderRow } from "./OrderRow";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SearchBox } from "@/components/SearchBox";

const ARCHIVED_LIMIT = 10;

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

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [orders, settings, categories] = await Promise.all([
    apiServerFetch<OrderDTO[]>("/api/orders"),
    apiServerFetch<BusinessSettingsDTO>("/api/settings"),
    apiServerFetch<CategoryDTO[]>("/api/products"),
  ]);
  const products = categories.flatMap((c) => c.products);

  const query = q?.trim().toLowerCase();
  const filtered = query
    ? orders.filter(
        (o) =>
          o.code.toLowerCase().includes(query) ||
          (o.customerName ?? "").toLowerCase().includes(query) ||
          o.phone.includes(query),
      )
    : orders;

  const active = filtered
    .filter((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const archived = filtered
    .filter((o) => o.status === "DELIVERED")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, ARCHIVED_LIMIT);

  return (
    <div>
      <AutoRefresh intervalMs={8000} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Pedidos vigentes</h2>
        <SearchBox placeholder="Buscar por código, cliente o teléfono..." />
      </div>
      <div style={{ marginTop: 16 }}>
        <OrdersGrid orders={active} settings={settings} products={products} emptyLabel="No hay pedidos vigentes." />
      </div>

      <h2 style={{ marginTop: "2rem" }}>Archivados (últimos {ARCHIVED_LIMIT} entregados)</h2>
      <OrdersGrid orders={archived} settings={settings} products={products} emptyLabel="Aún no hay pedidos entregados." />
    </div>
  );
}
