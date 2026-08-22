"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Refresca los datos del servidor cada `intervalMs` sin recargar toda la pagina —
 * asi mensajes/conversaciones nuevas aparecen solas, sin que el operador tenga que
 * darle F5 a mano cada vez que llega algo.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return null;
}
