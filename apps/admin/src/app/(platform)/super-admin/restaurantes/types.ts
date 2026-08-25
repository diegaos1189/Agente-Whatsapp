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

export const SEED_RESTAURANTS: PlatformRestaurant[] = [
  {
    id: "r-001",
    name: "Pollos El Corralito",
    city: "Bucaramanga",
    address: "Cra 27 #45-12",
    ownerPhone: "+57 310 555 0142",
    ownerEmail: "gerencia@elcorralito.co",
    currency: "COP",
    status: "ACTIVE",
    createdAt: "2025-11-04",
  },
  {
    id: "r-002",
    name: "Pizzería Don Marco",
    city: "Medellín",
    address: "Calle 10 #38-24, El Poblado",
    ownerPhone: "+57 315 555 0198",
    ownerEmail: "marco@donmarco.com",
    currency: "COP",
    status: "ACTIVE",
    createdAt: "2026-01-19",
  },
  {
    id: "r-003",
    name: "Burger Lab",
    city: "Ciudad de México",
    address: "Av. Álvaro Obregón 120, Roma Norte",
    ownerPhone: "+52 55 4821 3390",
    ownerEmail: "hola@burgerlab.mx",
    currency: "MXN",
    status: "ACTIVE",
    createdAt: "2026-03-02",
  },
  {
    id: "r-004",
    name: "Arepas La Esquina",
    city: "Cúcuta",
    address: "Av. 0 #12-40",
    ownerPhone: "+57 320 555 0077",
    ownerEmail: "",
    currency: "COP",
    status: "INACTIVE",
    createdAt: "2025-08-27",
  },
];

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
