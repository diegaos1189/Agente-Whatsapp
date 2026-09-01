"use client";

import { useState } from "react";

/** Formulario "Quiero una demo" de la landing publica — envia a /api/public-lead (sin sesion). */
export function LeadForm() {
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/public-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, contactName, phone, email, message }),
      });
      if (!res.ok) throw new Error("request failed");
      setStatus("sent");
      setBusinessName("");
      setContactName("");
      setPhone("");
      setEmail("");
      setMessage("");
    } catch {
      setStatus("error");
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.14)",
    fontSize: 14,
    boxSizing: "border-box",
  };

  if (status === "sent") {
    return (
      <div style={{ textAlign: "center", padding: "24px 12px" }}>
        <p style={{ fontWeight: 700, fontSize: 16, margin: "0 0 6px" }}>¡Listo! Ya recibimos tus datos.</p>
        <p style={{ color: "#4d4c52", fontSize: 13.5, margin: 0 }}>Te contactamos muy pronto.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420, margin: "0 auto" }}>
      <input
        style={inputStyle}
        placeholder="Nombre del negocio"
        value={businessName}
        onChange={(e) => setBusinessName(e.target.value)}
        required
      />
      <input
        style={inputStyle}
        placeholder="Tu nombre"
        value={contactName}
        onChange={(e) => setContactName(e.target.value)}
        required
      />
      <input
        style={inputStyle}
        placeholder="WhatsApp (con indicativo)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
      />
      <input
        style={inputStyle}
        type="email"
        placeholder="Correo (opcional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <textarea
        style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
        placeholder="Cuentanos de tu negocio (opcional)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button
        type="submit"
        disabled={status === "sending"}
        style={{
          background: "linear-gradient(135deg, #3fbf25, #2a8f17)",
          color: "#fff",
          fontWeight: 700,
          fontSize: 15,
          padding: "13px 26px",
          borderRadius: 999,
          border: "none",
          cursor: status === "sending" ? "default" : "pointer",
          opacity: status === "sending" ? 0.7 : 1,
        }}
      >
        {status === "sending" ? "Enviando..." : "Quiero que me contacten"}
      </button>
      {status === "error" && (
        <p style={{ color: "#c0392b", fontSize: 13, margin: 0, textAlign: "center" }}>
          No se pudo enviar, intenta de nuevo o escribenos por WhatsApp.
        </p>
      )}
    </form>
  );
}
