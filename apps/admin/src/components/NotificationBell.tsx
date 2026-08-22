"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClientFetch } from "@/lib/apiClient";
import type { ConversationSummaryDTO } from "@pollos/shared";

export function NotificationBell() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const conversations = await apiClientFetch<ConversationSummaryDTO[]>("/conversations");
        if (!cancelled) setCount(conversations.filter((c) => c.status === "WAITING_HUMAN").length);
      } catch {
        // silencioso: no vale la pena mostrar error por esto, se reintenta en el proximo tick
      }
    }

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Link href="/conversations" className="notif-bell" aria-label="Conversaciones esperando respuesta">
      🔔
      {count > 0 && <span className="notif-bell-badge">{count}</span>}
    </Link>
  );
}
