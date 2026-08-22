"use client";

import { useEffect, useState } from "react";

const FINAL_STATUSES = new Set(["DELIVERED", "CANCELLED"]);

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function OrderTimer({
  createdAt,
  status,
  thresholdMinutes,
  dispatchMinutes,
}: {
  createdAt: string;
  status: string;
  thresholdMinutes: number;
  dispatchMinutes?: number | null;
}) {
  const isFinal = FINAL_STATUSES.has(status);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (isFinal) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isFinal]);

  const createdMs = new Date(createdAt).getTime();
  const elapsedMs = now - createdMs;
  const elapsedMinutes = elapsedMs / 60000;
  const isOverdue = !isFinal && elapsedMinutes > thresholdMinutes;

  if (isFinal) {
    // Pedidos entregados: mostramos cuanto se demoro en despacharse de verdad (creacion ->
    // marcado DELIVERED), no un guion — le da control de tiempos al negocio sobre el historial.
    if (dispatchMinutes == null) {
      return (
        <span style={{ color: "#6b7280" }} title="Pedido finalizado">
          -
        </span>
      );
    }
    const wasOverdue = dispatchMinutes > thresholdMinutes;
    return (
      <span
        style={{ fontVariantNumeric: "tabular-nums", color: wasOverdue ? "#b91c1c" : "#166534" }}
        title={`Se demoro ${dispatchMinutes} min en despacharse (meta: ${thresholdMinutes} min)`}
      >
        {dispatchMinutes} min{wasOverdue ? " ⚠" : ""}
      </span>
    );
  }

  return (
    <span
      style={{
        fontVariantNumeric: "tabular-nums",
        color: isOverdue ? "#b91c1c" : "#166534",
        fontWeight: isOverdue ? 700 : 400,
      }}
      title={`Meta de preparacion: ${thresholdMinutes} min`}
    >
      {formatElapsed(elapsedMs)}
      {isOverdue ? " ⚠" : ""}
    </span>
  );
}
