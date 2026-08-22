"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";

export function ReplyBox({
  conversationId,
  disabled = false,
  disabledReason = "Toma la conversacion para responder.",
}: {
  conversationId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    setSending(true);
    setError(null);
    try {
      await apiClientFetch(`/conversations/${conversationId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: text.trim() }),
      });
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSend} className="wa-compose">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? disabledReason : "Escribe un mensaje"}
          className="wa-compose-input"
          disabled={sending || disabled}
        />
        <button type="submit" className="wa-compose-send" disabled={sending || disabled || !text.trim()} aria-label="Enviar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        </button>
      </form>
      {disabled && <div className="muted" style={{ marginTop: 6 }}>{disabledReason}</div>}
      {error && <div className="error-text" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
