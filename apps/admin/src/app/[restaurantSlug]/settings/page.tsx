import { notFound } from "next/navigation";
import { apiServerFetchForRestaurant } from "@/lib/apiServer";
import { getRestaurantBySlug } from "@/lib/platformRestaurant";
import type { CategoryDTO, BusinessSettingsDTO } from "@pollos/shared";
import { SettingsForm } from "@/app/(dashboard)/settings/SettingsForm";

/**
 * Configuracion de UN restaurante de la plataforma: nombre, horario, moneda, mensajes,
 * credenciales de WhatsApp. Es lo que el wizard de setup escribe para el restaurante local,
 * pero editable desde el panel para cualquier cliente dado de alta.
 */
export default async function RestaurantSettingsPage({ params }: { params: Promise<{ restaurantSlug: string }> }) {
  const { restaurantSlug } = await params;
  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) notFound();

  const [settings, categories] = await Promise.all([
    apiServerFetchForRestaurant<BusinessSettingsDTO>("/api/settings", restaurant.id),
    apiServerFetchForRestaurant<CategoryDTO[]>("/api/products", restaurant.id),
  ]);
  const productsCount = categories.reduce((acc, c) => acc + c.products.length, 0);

  // A proposito solo se cuenta lo que ya esta separado por restaurante. Pedidos,
  // conversaciones y FAQs todavia son globales al deployment: mostrarlos aca seria mostrarle
  // a este negocio los numeros de otro.
  const summary = [
    { label: "Categorías", value: categories.length },
    { label: "Productos", value: productsCount },
  ];

  const summaryPanel = (
    <div className="settings-section">
      <h3 style={{ margin: 0 }}>Resumen del catálogo</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        {summary.map((s) => (
          <div key={s.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8438rem" }}>
            <span className="muted">{s.label}</span>
            <span style={{ fontWeight: 700 }}>{s.value}</span>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: "0.6875rem", marginTop: 14, marginBottom: 0 }}>
        Pedidos y conversaciones todavía no están separados por restaurante.
      </p>
    </div>
  );

  return (
    <div style={{ maxWidth: 1200, marginLeft: "auto", marginRight: "auto" }}>
      <h2 style={{ marginBottom: 4 }}>Configuración</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
        Datos con los que el agente de {restaurant.name} atiende a sus clientes.
      </p>

      <SettingsForm settings={settings} summaryPanel={summaryPanel} />
    </div>
  );
}
