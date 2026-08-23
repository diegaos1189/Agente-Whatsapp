import { apiServerFetch } from "@/lib/apiServer";
import type { MetricsDTO } from "@pollos/shared";
import { DateRangeFilter } from "./DateRangeFilter";

const STATUS_LABELS: Record<string, string> = {
  AWAITING_PAYMENT: "Esperando confirmacion de pago",
  RECEIVED: "Recibido (en preparacion)",
  READY: "Listo",
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

const RISK_LABELS: Record<string, string> = {
  AWAITING_PAYMENT_STALE: "Pago pendiente estancado",
  RECEIVED_STALE: "Retraso en cocina",
  READY_FOR_PICKUP_STALE: "Listo para recoger sin cierre",
  READY_FOR_DISPATCH_STALE: "Listo sin despacho",
};

const SLA_STAGE_LABELS = [
  { key: "payment", label: "Confirmacion de pago", sampleKey: "paymentConfirmationSampleCount" as const, valueKey: "paymentConfirmationSlaMinutes" as const },
  { key: "kitchen", label: "Cocina hasta listo", sampleKey: "kitchenSampleCount" as const, valueKey: "kitchenSlaMinutes" as const },
  { key: "dispatch", label: "Listo hasta reparto", sampleKey: "dispatchSampleCount" as const, valueKey: "dispatchSlaMinutes" as const },
  { key: "delivery", label: "Reparto hasta entrega", sampleKey: "deliveryLegSampleCount" as const, valueKey: "deliveryLegSlaMinutes" as const },
] as const;

export default async function MetricsPage() {
  const metrics = await apiServerFetch<MetricsDTO>("/api/metrics");

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-419", { style: "currency", currency: metrics.currency, maximumFractionDigits: 0 }).format(amount);

  const prepOverEstimate = metrics.avgPrepMinutes !== null && metrics.avgPrepMinutes > metrics.estimatedPrepMinutes;
  const totalStatusOrders = Object.values(metrics.ordersByStatus).reduce((a, b) => a + b, 0);
  const riskEntries = Object.entries(metrics.riskByType as Record<string, number>);

  return (
    <div>
      <h2>Metricas</h2>
      <p className="muted" style={{ marginTop: -16, marginBottom: 24 }}>
        Vista operativa al 23 de agosto de 2026
      </p>

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
          <div className="stat-label">Pedidos ultimos 7 dias</div>
          <div className="stat-value">{metrics.ordersLast7Days}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Pedidos ultimos 30 dias</div>
          <div className="stat-value">{metrics.ordersLast30Days}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Ticket promedio</div>
          <div className="stat-value">{formatCurrency(metrics.avgTicket)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Tiempo de preparacion real</div>
          <div className={`stat-value ${metrics.avgPrepMinutes === null ? "" : prepOverEstimate ? "warn" : "ok"}`}>
            {metrics.avgPrepMinutes !== null ? `${metrics.avgPrepMinutes} min` : "-"}
          </div>
          <div className="stat-sub">Estimado configurado: {metrics.estimatedPrepMinutes} min</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Tiempo de entrega hoy</div>
          <div className="stat-value">{metrics.avgDeliveryMinutesToday !== null ? `${metrics.avgDeliveryMinutesToday} min` : "-"}</div>
          <div className="stat-sub">Promedio, pedidos a domicilio ya entregados</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Tiempo de entrega mes</div>
          <div className="stat-value">{metrics.avgDeliveryMinutesThisMonth !== null ? `${metrics.avgDeliveryMinutesThisMonth} min` : "-"}</div>
          <div className="stat-sub">Promedio, pedidos a domicilio ya entregados</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Conversaciones (30 dias)</div>
          <div className="stat-value">{metrics.totalConversations30Days}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">% Escalado a humano</div>
          <div className={`stat-value ${metrics.handoffRate > 30 ? "warn" : "ok"}`}>{metrics.handoffRate}%</div>
        </div>
      </div>

      <h3 style={{ marginTop: "2rem" }}>Operacion en riesgo</h3>
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Pedidos abiertos en riesgo</div>
          <div className={`stat-value ${metrics.riskOrdersOpen > 0 ? "warn" : "ok"}`}>{metrics.riskOrdersOpen}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Avisos proactivos (30 dias)</div>
          <div className="stat-value">{metrics.proactiveAlertsLast30Days}</div>
          <div className="stat-sub">Mensajes automaticos enviados por demora, pago o despacho</div>
        </div>
      </div>

      <div className="report-grid" style={{ marginTop: 16 }}>
        {riskEntries.map(([riskType, count]) => (
          <div key={riskType} className="report-card">
            <div className="pill pill-warning">{RISK_LABELS[riskType] ?? riskType}</div>
            <div className="report-card-value">{count}</div>
            <div className="muted" style={{ fontSize: "0.75rem", marginTop: 8 }}>
              Incidencias registradas en los ultimos 30 dias
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: "2rem" }}>SLA por etapa</h3>
      <div className="report-grid">
        {SLA_STAGE_LABELS.map((stage) => {
          const minutes = metrics[stage.valueKey];
          const sampleCount = metrics[stage.sampleKey];
          return (
            <div key={stage.key} className="report-card">
              <div className="pill pill-info">{stage.label}</div>
              <div className={`report-card-value ${minutes !== null && minutes > 45 ? "warn" : ""}`} style={{ marginTop: 10 }}>
                {minutes !== null ? `${minutes} min` : "-"}
              </div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: 8 }}>
                Muestras analizadas: {sampleCount}
              </div>
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: "2rem" }}>Ver historial por fecha</h3>
      <DateRangeFilter currency={metrics.currency} />

      <h3>Pedidos por estado (30 dias)</h3>
      {Object.keys(metrics.ordersByStatus).length === 0 ? (
        <p className="muted">Sin pedidos en este periodo.</p>
      ) : (
        <div className="report-grid">
          {Object.entries(metrics.ordersByStatus).map(([status, count]) => {
            const pct = totalStatusOrders > 0 ? Math.round((count / totalStatusOrders) * 100) : 0;
            return (
              <div key={status} className="report-card">
                <span className={`pill ${STATUS_PILL_CLASS[status] ?? "pill-neutral"}`}>{STATUS_LABELS[status] ?? status}</span>
                <div className="report-card-value">{count}</div>
                <div className="muted" style={{ fontSize: "0.75rem", marginBottom: 6 }}>
                  {pct}% de los pedidos del periodo
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
