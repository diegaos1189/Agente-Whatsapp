"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";

export function ReadyButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function markReady() {
    setLoading(true);
    try {
      await apiClientFetch(`/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "READY" }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" className="cta" onClick={markReady} disabled={loading}>
      {loading ? "Marcando..." : "Listo"}
    </button>
  );
}
