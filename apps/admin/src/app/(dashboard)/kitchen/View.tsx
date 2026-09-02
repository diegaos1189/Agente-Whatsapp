import { apiServerFetchScoped } from "@/lib/apiServer";
import type { BusinessSettingsDTO, OrderDTO } from "@pollos/shared";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ReadyButton } from "./ReadyButton";
import { PrintTicketButton } from "./PrintTicketButton";

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("es-419", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function minutesSince(dateIso: string) {
  return Math.floor((Date.now() - new Date(dateIso).getTime()) / 60000);
}

export async function KitchenView({
  restaurantId,
  basePath = "",
}: {
  /** Restaurante del panel abierto. Sin valor = el restaurante de este deployment. */
  restaurantId?: string;
  /** Prefijo de los links internos: "" en la raiz, "/<slug>" en el panel de un cliente. */
  basePath?: string;
} = {}) {
  const [orders, settings] = await Promise.all([
    apiServerFetchScoped<OrderDTO[]>("/api/orders?status=RECEIVED", restaurantId),
    apiServerFetchScoped<BusinessSettingsDTO>("/api/settings", restaurantId),
  ]);

  const pending = [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div>
      <AutoRefresh intervalMs={8000} />
      <h2 style={{ margin: 0 }}>Cocina</h2>
      <p className="muted">Pedidos en preparación, del más antiguo al más reciente.</p>

      {pending.length === 0 && <p className="muted">No hay pedidos pendientes de preparar.</p>}

      <div className="kitchen-grid">
        {pending.map((o) => {
          const mins = minutesSince(o.createdAt);
          const late = mins >= settings.estimatedPrepMinutes;
          return (
            <div
              key={o.id}
              data-kitchen-ticket={o.id}
              className={`kitchen-card${late ? " kitchen-card-late" : ""}`}
            >
              <div className="kitchen-card-header">
                <strong>#{o.code}</strong>
                <span className={`pill ${late ? "pill-danger" : "pill-warning"}`}>{mins} min</span>
              </div>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                {o.customerName ?? o.phone} · {o.deliveryType === "DELIVERY" ? "Domicilio" : "Recoge en local"}
              </div>

              <ul className="kitchen-item-list">
                {o.items.map((it) => (
                  <li key={it.id}>
                    <strong>{it.quantity}×</strong> {it.productName}
                    {it.notes && <div className="muted" style={{ fontSize: "0.8rem" }}>Nota: {it.notes}</div>}
                  </li>
                ))}
              </ul>

              {o.address && <div className="muted" style={{ fontSize: "0.8rem" }}>{o.address}{o.neighborhood ? `, ${o.neighborhood}` : ""}</div>}
              <div className="muted" style={{ fontSize: "0.8rem" }}>Total: {formatCurrency(o.total, settings.currency)}</div>

              <div className="kitchen-card-actions">
                <PrintTicketButton orderId={o.id} />
                <ReadyButton orderId={o.id} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
