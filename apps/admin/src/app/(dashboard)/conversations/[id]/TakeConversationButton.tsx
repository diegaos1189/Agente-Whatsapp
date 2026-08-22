"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";

export function TakeConversationButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await apiClientFetch(`/conversations/${conversationId}/take`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className="chat-header-btn" onClick={handleClick} disabled={loading}>
      {loading ? "Tomando..." : "Tomar conversacion"}
    </button>
  );
}
