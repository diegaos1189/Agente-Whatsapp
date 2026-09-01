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

  if (status === "sent") {
    return (
      <div className="lp-form-success">
        <div className="lp-form-success-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <p>¡Listo! Ya recibimos tus datos.</p>
        <p>Te contactamos muy pronto.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="lp-form">
      <input
        className="lp-field"
        placeholder="Nombre del negocio"
        value={businessName}
        onChange={(e) => setBusinessName(e.target.value)}
        required
      />
      <input
        className="lp-field"
        placeholder="Tu nombre"
        value={contactName}
        onChange={(e) => setContactName(e.target.value)}
        required
      />
      <input
        className="lp-field"
        placeholder="WhatsApp (con indicativo)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
      />
      <input
        className="lp-field"
        type="email"
        placeholder="Correo (opcional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <textarea
        className="lp-field"
        placeholder="Cuentanos de tu negocio (opcional)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button type="submit" disabled={status === "sending"} className="lp-btn lp-btn-primary lp-submit">
        <span>{status === "sending" ? "Enviando..." : "Quiero que me contacten"}</span>
      </button>
      {status === "error" && (
        <p className="lp-form-error">No se pudo enviar, intenta de nuevo o escríbenos por WhatsApp.</p>
      )}
    </form>
  );
}
