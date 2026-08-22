import Link from "next/link";
import { apiServerFetch } from "@/lib/apiServer";
import type { AdminUserDTO, CategoryDTO, ConversationSummaryDTO, FaqDTO, OrderDTO, PromotionDTO, BusinessSettingsDTO } from "@pollos/shared";
import { SettingsForm } from "./SettingsForm";

const MODULE_LINKS = [
  { href: "/metrics", label: "Métricas" },
  { href: "/conversations", label: "Conversaciones" },
  { href: "/orders", label: "Pedidos" },
  { href: "/products", label: "Productos" },
  { href: "/promotions", label: "Promociones" },
  { href: "/faqs", label: "Preguntas frecuentes" },
  { href: "/users", label: "Usuarios" },
];

export default async function SettingsPage() {
  const [settings, users, categories, orders, promotions, faqs, conversations] = await Promise.all([
    apiServerFetch<BusinessSettingsDTO>("/api/settings"),
    apiServerFetch<AdminUserDTO[]>("/api/admin-users"),
    apiServerFetch<CategoryDTO[]>("/api/products"),
    apiServerFetch<OrderDTO[]>("/api/orders"),
    apiServerFetch<PromotionDTO[]>("/api/promotions/all"),
    apiServerFetch<FaqDTO[]>("/api/faqs"),
    apiServerFetch<ConversationSummaryDTO[]>("/api/conversations"),
  ]);
  const productsCount = categories.reduce((acc, c) => acc + c.products.length, 0);

  const summary = [
    { label: "Usuarios", value: users.length },
    { label: "Conversaciones activas", value: conversations.length },
    { label: "Productos", value: productsCount },
    { label: "Pedidos", value: orders.length },
    { label: "Promociones", value: promotions.length },
    { label: "Preguntas frecuentes", value: faqs.length },
  ];

  const summaryPanel = (
    <div className="settings-section">
      <h3 style={{ margin: 0 }}>Resumen del sistema</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        {summary.map((s) => (
          <div key={s.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8438rem" }}>
            <span className="muted">{s.label}</span>
            <span style={{ fontWeight: 700 }}>{s.value}</span>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: "0.6875rem", marginTop: 14, marginBottom: 0 }}>
        Información actualizada el {new Date().toLocaleDateString("es-419")}
      </p>
    </div>
  );

  return (
    <div style={{ maxWidth: 1200, marginLeft: "auto", marginRight: "auto" }}>
      <h2 style={{ marginBottom: 4 }}>Administración</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>Información general del negocio y accesos a los módulos.</p>

      <SettingsForm settings={settings} summaryPanel={summaryPanel} />

      <div className="settings-section settings-full" style={{ marginTop: 20 }}>
        <h3>Accesos a módulos</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {MODULE_LINKS.map((m) => (
            <Link key={m.href} href={m.href} className="wa-list-btn">
              {m.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
