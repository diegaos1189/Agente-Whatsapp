"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";

interface AlertQuickActionsProps {
  orderId: string;
  status: string;
  deliveryType: string;
  flaggedForReview: boolean;
}

export function AlertQuickActions({
  orderId,
  status,
  deliveryType,
  flaggedForReview,
}: AlertQuickActionsProps) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  async function runAction(actionKey: string, request: () => Promise<unknown>) {
    setLoadingAction(actionKey);
    try {
      await request();
      router.refresh();
    } finally {
      setLoadingAction(null);
    }
  }

  const actions: Array<{ key: string; label: string; kind?: "secondary" | "danger"; onClick: () => Promise<unknown> }> = [];

  if (status === "AWAITING_PAYMENT") {
    actions.push({
      key: "confirm-payment",
      label: "Confirmar pago",
      onClick: () => apiClientFetch(`/orders/${orderId}/confirm-payment`, { method: "POST" }),
    });
  }

  if (status === "RECEIVED") {
    actions.push({
      key: "mark-ready",
      label: "Marcar listo",
      onClick: () =>
        apiClientFetch(`/orders/${orderId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "READY" }),
        }),
    });
  }

  if (status === "READY") {
    actions.push({
      key: deliveryType === "PICKUP" ? "mark-delivered" : "mark-on-the-way",
      label: deliveryType === "PICKUP" ? "Marcar entregado" : "Enviar a reparto",
      onClick: () =>
        apiClientFetch(`/orders/${orderId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: deliveryType === "PICKUP" ? "DELIVERED" : "ON_THE_WAY" }),
        }),
    });
  }

  if (flaggedForReview) {
    actions.push({
      key: "clear-flag",
      label: "Ya revise",
      kind: "secondary",
      onClick: () => apiClientFetch(`/orders/${orderId}/clear-flag`, { method: "POST" }),
    });
  }

  if (actions.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          className={action.kind === "secondary" ? "secondary" : undefined}
          disabled={loadingAction !== null}
          onClick={() => runAction(action.key, action.onClick)}
          style={{ fontSize: "0.78rem", padding: "8px 10px" }}
        >
          {loadingAction === action.key ? "Procesando..." : action.label}
        </button>
      ))}
    </div>
  );
}
