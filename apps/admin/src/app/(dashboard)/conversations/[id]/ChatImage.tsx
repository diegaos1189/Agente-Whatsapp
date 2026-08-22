"use client";

import { useState } from "react";

export function ChatImage({ mediaUrl, messageId }: { mediaUrl: string; messageId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ background: "none", padding: 0, border: "none", cursor: "pointer" }}
      >
        <img
          src={mediaUrl}
          alt="Imagen enviada por el cliente"
          style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, display: "block" }}
        />
      </button>
      <a href={mediaUrl} download={`comprobante-${messageId}.jpg`} className="link" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
        Descargar imagen
      </a>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 24,
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "rgba(255,255,255,0.15)",
              color: "#fff",
              width: 36,
              height: 36,
              borderRadius: "50%",
              fontSize: 18,
            }}
          >
            ✕
          </button>
          <img
            src={mediaUrl}
            alt="Imagen enviada por el cliente (ampliada)"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 8, objectFit: "contain" }}
          />
        </div>
      )}
    </div>
  );
}
