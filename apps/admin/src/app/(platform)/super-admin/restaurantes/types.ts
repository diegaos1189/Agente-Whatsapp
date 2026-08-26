/**
 * Modelo mock del area de plataforma. No existe en Prisma todavia (BusinessSettings sigue
 * siendo una sola fila): esto es solo para las pantallas, hasta que haya backend multi-tenant.
 */
export interface PlatformRestaurant {
  id: string;
  name: string;
  city: string;
  address: string;
  ownerPhone: string;
  ownerEmail: string;
  currency: string;
  status: RestaurantStatus;
  /** ISO date (YYYY-MM-DD) — se guarda como texto para que sobreviva a localStorage. */
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

/** Ids de los restaurantes de ejemplo que existieron antes: se filtran al leer localStorage. */
export const LEGACY_SEED_IDS = ["r-001", "r-002", "r-003", "r-004"];

/** dd/mm/aaaa a mano: toLocaleDateString cambia entre servidor y navegador y rompe la hidratacion. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
