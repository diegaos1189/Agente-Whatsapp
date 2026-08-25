import Link from "next/link";

/**
 * 404 global del panel (App Router: `not-found.tsx` en la raiz de `app/`). Renderiza dentro
 * del root layout, sin sidebar, porque una ruta inexistente puede caer fuera de cualquier
 * seccion. Pagina estatica y generica — sin datos del negocio — porque el root layout no
 * carga settings y esto debe funcionar igual en el panel, la plataforma y la landing.
 */
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 440 }}>
        <div
          aria-hidden
          style={{
            fontSize: "5.5rem",
            fontWeight: 700,
            lineHeight: 1,
            color: "var(--accent)",
            letterSpacing: "-0.03em",
          }}
        >
          404
        </div>
        <h1 style={{ fontSize: "1.5rem", margin: "16px 0 8px" }}>Página no encontrada</h1>
        <p className="muted" style={{ fontSize: "0.9375rem", marginBottom: 28 }}>
          La página que buscas no existe o fue movida. Revisa la dirección o vuelve al inicio.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {/* Mismo degradado que button.cta — esa clase solo aplica a <button>, aca es un enlace. */}
          <Link
            href="/"
            style={{
              background: "linear-gradient(135deg, #3fbf25, #2a8f17)",
              boxShadow: "0 4px 14px rgba(49, 167, 27, 0.35)",
              color: "#fff",
              padding: "10px 22px",
              borderRadius: 10,
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
            }}
          >
            Volver al inicio
          </Link>
          {/* El middleware redirige a login o a la primera seccion permitida segun el rol. */}
          <Link
            href="/conversations"
            style={{
              border: "1px solid var(--border-strong)",
              background: "var(--surface-solid)",
              color: "var(--text)",
              padding: "10px 22px",
              borderRadius: 10,
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
            }}
          >
            Ir al panel
          </Link>
        </div>
      </div>
    </main>
  );
}
