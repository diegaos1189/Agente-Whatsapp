"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";

const BASE_STATUSES: Array<{ value: string; label: string }> = [
  { value: "RECEIVED", label: "Recibido (en preparacion)" },
  { value: "ON_THE_WAY", label: "En reparto" },
  { value: "DELIVERED", label: "Entregado" },
  { value: "CANCELLED", label: "Cancelado" },
];

export function OrderStatusSelect({
  orderId,
  status,
  deliveryType,
}: {
  orderId: string;
  status: string;
  deliveryType: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [loading, setLoading] = useState(false);

  const statuses = [
    BASE_STATUSES[0]!,
    {
      value: "READY",
      label: deliveryType === "PICKUP" ? "Listo para recoger" : "Listo (esperando despacho)",
    },
    ...BASE_STATUSES.slice(1),
  ];

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setCurrent(next);
    setLoading(true);
    try {
      await apiClientFetch(`/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <select value={current} onChange={handleChange} disabled={loading}>
      {statuses.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
