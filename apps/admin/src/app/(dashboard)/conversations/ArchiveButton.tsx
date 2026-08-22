"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";

export function ArchiveButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!confirm("¿Archivar esta conversacion? Desaparece de la lista, el bot ya no le va a responder.")) return;
    setLoading(true);
    try {
      await apiClientFetch(`/conversations/${conversationId}/archive`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" className="secondary" onClick={handleClick} disabled={loading} style={{ fontSize: 12 }}>
      {loading ? "Archivando..." : "Archivar"}
    </button>
  );
}
