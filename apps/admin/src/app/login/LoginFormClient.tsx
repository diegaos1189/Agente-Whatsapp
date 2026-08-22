"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NavIcon, type NavIconName } from "../(dashboard)/NavIcon";

const FEATURES: Array<{ icon: NavIconName; label: string }> = [
  { icon: "conversations", label: "Agente de WhatsApp con IA" },
  { icon: "orders", label: "Gestión de pedidos" },
  { icon: "kitchen", label: "Pantalla de cocina" },
  { icon: "products", label: "Catálogo de productos y combos" },
  { icon: "facturacion", label: "Facturación automática" },
  { icon: "users", label: "Roles y permisos por usuario" },
  { icon: "capacitacion", label: "Capacitación paso a paso" },
  { icon: "metrics", label: "Reportes y métricas" },
];

export function LoginFormClient({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const configError = searchParams.get("error") === "session-config";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        setError("Usuario o contrasena incorrectos");
        return;
      }
      const data = (await res.json()) as { redirectTo?: string };
      router.push(searchParams.get("next") || data.redirectTo || "/metrics");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        background: "linear-gradient(160deg, #fdf6f0 0%, #f5f5f7 45%, #f5f5f7 100%)",
        color: "#1d1d1f",
        padding: "48px 24px",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          gap: 48,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 420px", minWidth: 300 }}>
          <span
            style={{
              display: "inline-block",
              background: "rgba(255, 95, 61, 0.1)",
              color: "#ff5f3d",
              fontSize: 12,
              fontWeight: 700,
              padding: "5px 12px",
              borderRadius: 999,
              marginBottom: 18,
            }}
          >
            Agente WhatsApp + CRM/POS
          </span>
          <h1 style={{ fontSize: "2.25rem", lineHeight: 1.15, margin: "0 0 14px", fontWeight: 800 }}>
            Administra tu negocio de comida desde una sola plataforma
          </h1>
          <p style={{ color: "#6e6e73", fontSize: "1rem", lineHeight: 1.6, margin: "0 0 28px", maxWidth: 480 }}>
            Automatiza pedidos por WhatsApp con inteligencia artificial y controla menú, cocina, facturación y equipo
            desde un solo panel. Listo para adaptar a restaurantes, pizzerías, hamburgueserías y negocios de comida
            similares.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {FEATURES.map((f) => (
              <div
                key={f.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "#ffffff",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: "rgba(255, 95, 61, 0.1)",
                    color: "#ff5f3d",
                    flexShrink: 0,
                  }}
                >
                  <NavIcon name={f.icon} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            flex: "0 1 380px",
            minWidth: 300,
            background: "#ffffff",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 16,
            padding: 32,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
          }}
        >
          {logoUrl && (
            <img
              src={logoUrl}
              alt="Logo del negocio"
              style={{
                width: 96,
                height: 96,
                objectFit: "contain",
                borderRadius: 16,
                margin: "0 auto 4px",
                border: "1px solid rgba(0,0,0,0.08)",
                background: "#f5f5f7",
              }}
            />
          )}
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "1.375rem" }}>Bienvenido de nuevo</h2>
            <p style={{ margin: 0, color: "#6e6e73", fontSize: 13 }}>Ingresa con tu usuario para administrar el negocio.</p>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: "#6e6e73" }}>
            Usuario
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              style={{
                background: "#f5f5f7",
                color: "#1d1d1f",
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 8,
                padding: "11px 14px",
                fontSize: 14,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: "#6e6e73" }}>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                background: "#f5f5f7",
                color: "#1d1d1f",
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 8,
                padding: "11px 14px",
                fontSize: 14,
              }}
            />
          </label>
          {(error || configError) && (
            <div style={{ color: "#ff3b30", fontSize: 13 }}>
              {error ?? "El panel no puede iniciar sesion porque falta SESSION_SECRET en produccion."}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              background:
                loading || !username || !password
                  ? "#f5c4ac"
                  : "linear-gradient(135deg, #ff8a3d, #ff5f3d)",
              color: "#ffffff",
              border: "none",
              borderRadius: 999,
              padding: "12px 16px",
              fontSize: 15,
              fontWeight: 700,
              cursor: loading || !username || !password ? "default" : "pointer",
            }}
          >
            {loading ? "Entrando..." : "Ingresar"}
          </button>
          <p style={{ margin: 0, textAlign: "center", color: "#6e6e73", fontSize: 12 }}>Acceso restringido a personal autorizado.</p>
        </form>
      </div>

      <p style={{ textAlign: "center", color: "#6e6e73", fontSize: 12, marginTop: 56 }}>
        Creado por <span style={{ color: "#ff5f3d", fontWeight: 700 }}>KenzyGroup S.A.S</span>
      </p>
    </div>
  );
}
