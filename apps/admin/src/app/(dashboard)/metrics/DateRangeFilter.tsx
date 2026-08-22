"use client";

import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { RangeMetricsDTO } from "@pollos/shared";

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthISODate(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

export function DateRangeFilter({ currency }: { currency: string }) {
  const [from, setFrom] = useState(firstOfMonthISODate());
  const [to, setTo] = useState(todayISODate());
  const [result, setResult] = useState<RangeMetricsDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // "to" incluye el dia completo (hasta las 23:59:59) para que el filtro sea inclusivo.
      const fromISO = new Date(`${from}T00:00:00`).toISOString();
      const toISO = new Date(`${to}T23:59:59.999`).toISOString();
      const data = await apiClientFetch<RangeMetricsDTO>(
        `/metrics/range?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el historial");
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-419", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

  return (
    <div style={{ marginBottom: 24 }}>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label>
          Desde
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Buscando..." : "Ver ventas"}
        </button>
      </form>

      {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}

      {result && (
        <div>
          <h4 style={{ marginBottom: 8 }}>
            Reporte del {from} al {to}
          </h4>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="stat-label">Ventas en el rango</div>
              <div className="stat-value">{formatCurrency(result.revenue)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Pedidos en el rango</div>
              <div className="stat-value">{result.orderCount}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Ticket promedio</div>
              <div className="stat-value">{formatCurrency(result.avgTicket)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
