/**
 * Restaurante cliente de la plataforma, tal como lo devuelve la API
 * (GET /api/platform/restaurants — tabla platform_restaurants).
 */
export interface PlatformRestaurant {
  id: string;
  name: string;
  /** Identificador del link publico (<url-del-panel>/<slug>). Lo genera la API desde el nombre. */
  slug: string;
  city: string;
  address: string;
  ownerPhone: string;
  ownerEmail: string;
  currency: string;
  status: RestaurantStatus;
  /** ISO datetime que entrega la API (ej: 2026-08-26T14:03:00.000Z). */
  createdAt: string;
}

export type RestaurantStatus = "ACTIVE" | "INACTIVE";

/** Mismos codigos ISO que acepta el campo Moneda de Configuración, aca como lista cerrada. */
export const CURRENCY_OPTIONS = [
  { code: "COP", label: "COP — Peso colombiano" },
  { code: "MXN", label: "MXN — Peso mexicano" },
  { code: "USD", label: "USD — Dólar" },
  { code: "ARS", label: "ARS — Peso argentino" },
  { code: "CLP", label: "CLP — Peso chileno" },
  { code: "PEN", label: "PEN — Sol peruano" },
  { code: "EUR", label: "EUR — Euro" },
] as const;

/** Ids de los restaurantes de ejemplo que existieron antes: se excluyen al importar localStorage. */
export const LEGACY_SEED_IDS = ["r-001", "r-002", "r-003", "r-004"];

/** dd/mm/aaaa a mano: toLocaleDateString cambia entre servidor y navegador y rompe la hidratacion. */
export function formatDate(iso: string): string {
  const datePart = iso.split("T")[0] ?? iso;
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}
