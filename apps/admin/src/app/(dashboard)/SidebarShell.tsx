"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function SidebarShell({
  title,
  logoUrl,
  children,
  footer,
}: {
  title: string;
  logoUrl?: string | null;
  children: ReactNode;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

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
        {logoUrl && <img src={logoUrl} alt="" className="mobile-topbar-logo" />}
        <span className="mobile-topbar-title">{title}</span>
      </div>
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
      <aside className={`sidebar${open ? " sidebar-open" : ""}`}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="mobile-close-btn" onClick={() => setOpen(false)} aria-label="Cerrar menu">
            ✕
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 28, minWidth: 0 }}>
          {logoUrl && <img src={logoUrl} alt="" className="sidebar-logo" />}
          <h1
            style={{
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
              textAlign: "center",
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
