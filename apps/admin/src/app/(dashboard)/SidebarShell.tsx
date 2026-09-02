"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function SidebarShell({
  title,
  logoUrl,
  logoVariant = "square",
  logoSlot,
  children,
  footer,
}: {
  title: string;
  logoUrl?: string | null;
  /** "square": logo del negocio grande y centrado. "wordmark": marca pequeña alineada a la izquierda. */
  logoVariant?: "square" | "wordmark";
  /** Reemplaza la imagen del logo en la barra lateral (ej: el logo subible del panel de un cliente). */
  logoSlot?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isWordmark = logoVariant === "wordmark";

  // Cierra el menu automaticamente al navegar a otra pagina — sin esto se quedaba abierto
  // tapando el contenido despues de tocar un link en movil.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="mobile-topbar">
        <button type="button" className="mobile-menu-btn" onClick={() => setOpen(true)} aria-label="Abrir menu">
          ☰
        </button>
        {logoUrl && <img src={logoUrl} alt="" className={isWordmark ? "mobile-topbar-logo-wordmark" : "mobile-topbar-logo"} />}
        <span className="mobile-topbar-title">{title}</span>
      </div>
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
      <aside className={`sidebar${open ? " sidebar-open" : ""}`}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="mobile-close-btn" onClick={() => setOpen(false)} aria-label="Cerrar menu">
            ✕
          </button>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: isWordmark ? "flex-start" : "center",
            gap: 10,
            marginBottom: 28,
            minWidth: 0,
          }}
        >
          {logoSlot ?? (logoUrl && <img src={logoUrl} alt="" className={isWordmark ? "sidebar-logo-wordmark" : "sidebar-logo"} />)}
          <h1
            style={{
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
              textAlign: isWordmark ? "left" : "center",
            }}
          >
            {title}
          </h1>
        </div>
        {children}
        <div style={{ marginTop: "auto", paddingTop: 20 }}>{footer}</div>
      </aside>
    </>
  );
}
