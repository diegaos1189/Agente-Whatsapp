"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Contenedor con scroll propio del hilo de chat. Dos cosas que necesita el operador:
 * - Abrir la conversacion mostrando lo ULTIMO (como WhatsApp), no el primer mensaje de hace
 *   dos horas, que obligaba a bajar a mano en cada conversacion larga.
 * - No perder el punto de lectura: AutoRefresh trae mensajes nuevos cada 4s, y si el operador
 *   subio a leer historial, bajarlo de golpe cada vez seria peor que no auto-scrollear.
 */
export function ChatThread({ lastMessageId, children }: { lastMessageId: string | null; children: ReactNode }) {
  const threadRef = useRef<HTMLDivElement>(null);
  // Arranca pegado abajo; deja de estarlo apenas el operador sube a leer.
  const stickToBottom = useRef(true);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread || !stickToBottom.current) return;
    thread.scrollTop = thread.scrollHeight;
  }, [lastMessageId]);

  function handleScroll() {
    const thread = threadRef.current;
    if (!thread) return;
    // Margen de 120px: si esta "casi abajo" se sigue considerando que quiere ver lo nuevo.
    stickToBottom.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
  }

  return (
    <div className="chat-thread" ref={threadRef} onScroll={handleScroll}>
      {children}
    </div>
  );
}
