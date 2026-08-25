"use client";

import { useState, type ReactNode } from "react";

/**
 * Confirmacion antes de una accion destructiva. Con `requireTyping` pide escribir "confirmar",
 * el mismo gesto que ya usa ProductModal para borrar de verdad.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  requireTyping = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireTyping?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const canConfirm = !requireTyping || typed.trim().toLowerCase() === "confirmar";

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: "94vw",
          background: "var(--surface-solid)",
          padding: 24,
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-card)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h4 style={{ margin: 0 }}>{title}</h4>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>{message}</p>
        {requireTyping && (
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canConfirm && onConfirm()}
            placeholder="confirmar"
          />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className={danger ? "danger" : "cta"} disabled={!canConfirm} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
