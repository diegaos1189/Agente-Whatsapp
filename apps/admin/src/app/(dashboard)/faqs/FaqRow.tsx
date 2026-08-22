"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { FaqDTO } from "@pollos/shared";

export function FaqRow({ faq }: { faq: FaqDTO }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function toggleActive() {
    setSaving(true);
    try {
      await apiClientFetch(`/faqs/${faq.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !faq.isActive }) });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar esta pregunta frecuente?")) return;
    setSaving(true);
    try {
      await apiClientFetch(`/faqs/${faq.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>{faq.question}</td>
      <td className="muted">{faq.answer}</td>
      <td>
        <input type="checkbox" checked={faq.isActive} onChange={toggleActive} disabled={saving} />
      </td>
      <td>
        <button className="danger" onClick={handleDelete} disabled={saving}>
          Eliminar
        </button>
      </td>
    </tr>
  );
}
