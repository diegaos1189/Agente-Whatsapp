import { apiServerFetch } from "@/lib/apiServer";
import type { MetricsDTO } from "@pollos/shared";
import { DateRangeFilter } from "./DateRangeFilter";

const STATUS_LABELS: Record<string, string> = {
  AWAITING_PAYMENT: "Esperando confirmación de pago",
  RECEIVED: "Recibido (en preparación)",
  READY: "Listo (buscando domiciliario)",
  ON_THE_WAY: "En reparto",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

const STATUS_PILL_CLASS: Record<string, string> = {
  RECEIVED: "pill-info",
  READY: "pill-success",
  ON_THE_WAY: "pill-info",
  DELIVERED: "pill-neutral",
  CANCELLED: "pill-danger",
  AWAITING_PAYMENT: "pill-warning",
};

const STATUS_BAR_COLOR: Record<string, string> = {
  RECEIVED: "#0a84ff",
  READY: "#34c759",
  ON_THE_WAY: "#0a84ff",
  DELIVERED: "#8e8e93",
  CANCELLED: "#ff3b30",
  AWAITING_PAYMENT: "#ff9500",
};

export default async function MetricsPage() {
  const metrics = await apiServerFetch<MetricsDTO>("/api/metrics");

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-419", { style: "currency", currency: metrics.currency, maximumFractionDigits: 0 }).format(amount);

  const prepOverEstimate = metrics.avgPrepMinutes !== null && metrics.avgPrepMinutes > metrics.estimatedPrepMinutes;

  return (
    <div>
      <h2>Métricas</h2>
      <p className="muted" style={{ marginTop: -16, marginBottom: 24 }}>Últimos 30 días</p>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Venta de hoy</div>
          <div className="stat-value">{formatCurrency(metrics.revenueToday)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Venta del mes</div>
          <div className="stat-value">{formatCurrency(metrics.revenueThisMonth)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Pedidos hoy</div>
          <div className="stat-value">{metrics.ordersToday}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Pedidos últimos 7 días</div>
          <div className="stat-value">{metrics.ordersLast7Days}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Pedidos últimos 30 días</div>
          <div className="stat-value">{metrics.ordersLast30Days}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Ticket promedio</div>
          <div className="stat-value">{formatCurrency(metrics.avgTicket)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Tiempo de preparación real</div>
          <div className={`stat-value ${metrics.avgPrepMinutes === null ? "" : prepOverEstimate ? "warn" : "ok"}`}>
            {metrics.avgPrepMinutes !== null ? `${metrics.avgPrepMinutes} min` : "-"}
          </div>
          <div className="stat-sub">Estimado configurado: {metrics.estimatedPrepMinutes} min</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Tiempo de entrega — hoy</div>
          <div className="stat-value">{metrics.avgDeliveryMinutesToday !== null ? `${metrics.avgDeliveryMinutesToday} min` : "-"}</div>
          <div className="stat-sub">Promedio, pedidos a domicilio ya entregados</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Tiempo de entrega — mes</div>
          <div className="stat-value">
            {metrics.avgDeliveryMinutesThisMonth !== null ? `${metrics.avgDeliveryMinutesThisMonth} min` : "-"}
          </div>
          <div className="stat-sub">Promedio, pedidos a domicilio ya entregados</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Conversaciones (30 días)</div>
          <div className="stat-value">{metrics.totalConversations30Days}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">% Escalado a humano</div>
          <div className={`stat-value ${metrics.handoffRate > 30 ? "warn" : "ok"}`}>{metrics.handoffRate}%</div>
        </div>
      </div>

      <h3 style={{ marginTop: "2rem" }}>Ver historial por fecha</h3>
      <DateRangeFilter currency={metrics.currency} />

      <h3>Pedidos por estado (30 días)</h3>
      {Object.keys(metrics.ordersByStatus).length === 0 ? (
        <p className="muted">Sin pedidos en este período.</p>
      ) : (
        <div className="report-grid">
          {Object.entries(metrics.ordersByStatus).map(([status, count]) => {
            const totalStatusOrders = Object.values(metrics.ordersByStatus).reduce((a, b) => a + b, 0);
            const pct = totalStatusOrders > 0 ? Math.round((count / totalStatusOrders) * 100) : 0;
            return (
              <div key={status} className="report-card">
                <span className={`pill ${STATUS_PILL_CLASS[status] ?? "pill-neutral"}`}>{STATUS_LABELS[status] ?? status}</span>
                <div className="report-card-value">{count}</div>
                <div className="muted" style={{ fontSize: "0.75rem", marginBottom: 6 }}>
                  {pct}% de los pedidos del período
                </div>
                <div className="report-card-progress">
                  <div
                    className="report-card-progress-fill"
                    style={{ width: `${pct}%`, background: STATUS_BAR_COLOR[status] ?? "#8e8e93" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
