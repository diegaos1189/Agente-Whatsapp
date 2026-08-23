import { apiServerFetch } from "@/lib/apiServer";
import type { BusinessSettingsDTO, OrderDTO } from "@pollos/shared";
import { SearchBox } from "@/components/SearchBox";
import { MarkPaidButton } from "./MarkPaidButton";

const PAYMENT_PILL: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pendiente de pago", className: "pill-warning" },
  REPORTED: { label: "Reportado, sin confirmar", className: "pill-warning" },
  PROCESSING: { label: "Procesando", className: "pill-info" },
  AUTHORIZED: { label: "Autorizado", className: "pill-info" },
  PAID: { label: "Pagada", className: "pill-success" },
  FAILED: { label: "Fallida", className: "pill-danger" },
  CANCELLED: { label: "Cancelada", className: "pill-neutral" },
  PARTIALLY_REFUNDED: { label: "Refund parcial", className: "pill-warning" },
  REFUNDED: { label: "Refund total", className: "pill-neutral" },
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("es-419", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [orders, settings] = await Promise.all([
    apiServerFetch<OrderDTO[]>("/api/orders"),
    apiServerFetch<BusinessSettingsDTO>("/api/settings"),
  ]);

  const query = q?.trim().toLowerCase();
  const filtered = query
    ? orders.filter(
        (o) =>
          o.code.toLowerCase().includes(query) ||
          (o.customerName ?? "").toLowerCase().includes(query) ||
          o.phone.includes(query),
      )
    : orders;

  const invoices = [...filtered]
    .filter((o) => o.status !== "CANCELLED")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Facturación</h2>
          <p className="muted" style={{ marginTop: 4 }}>
            Registro de ventas y control de domicilios - se genera solo por cada pedido, sin captura manual.
          </p>
        </div>
        <SearchBox placeholder="Buscar por número, cliente o teléfono..." />
      </div>

      {invoices.length === 0 ? (
        <p className="muted">Aún no hay facturas.</p>
      ) : (
        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Factura</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Entrega</th>
                <th>Estado</th>
                <th>Total</th>
                <th>Pago</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((o) => {
                const pill = PAYMENT_PILL[o.paymentStatus] ?? { label: o.paymentStatus, className: "pill-neutral" };
                return (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.code}</strong>
                    </td>
                    <td>
                      {o.customerName ?? "Cliente"} <span className="muted">· {o.phone}</span>
                    </td>
                    <td>{new Date(o.createdAt).toLocaleDateString("es-419")}</td>
                    <td>
                      {o.deliveryType === "DELIVERY"
                        ? `Domicilio${o.address ? ` · ${o.address}${o.neighborhood ? `, ${o.neighborhood}` : ""}` : ""}`
                        : "Recoge en local"}
                    </td>
                    <td>
                      <span className={`pill ${pill.className}`}>{pill.label}</span>
                    </td>
                    <td>
                      <strong>{formatCurrency(o.total, settings.currency)}</strong>
                    </td>
                    <td>
                      {o.paymentMethod === "TRANSFER" ? (
                        <span className="muted" style={{ fontSize: 12 }}>Se confirma en Pedidos</span>
                      ) : (
                        <MarkPaidButton orderId={o.id} paid={o.paymentStatus === "PAID"} />
                      )}
                    </td>
                    <td>
                      <a href={`/orders?q=${encodeURIComponent(o.code)}`} className="link">
                        Ver pedido
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
