"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";

export function MarkPaidButton({ orderId, paid }: { orderId: string; paid: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markPaid() {
    setSaving(true);
    setError(null);
    try {
      await apiClientFetch(`/orders/${orderId}/mark-paid`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el pago");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button type="button" className="cta" disabled={paid || saving} onClick={markPaid}>
        {paid ? "Pagado" : saving ? "Registrando..." : "Pagado"}
      </button>
      {error && <div className="error-text" style={{ fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
