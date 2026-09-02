import { getSession } from "@/lib/session";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN ?? "";

/**
 * Fetch server-side (Server Components / Route Handlers) con el token admin.
 * Ademas reenvia los headers x-admin-* derivados de la cookie de sesion (si existe),
 * igual que hace /api/proxy/[...path] para las llamadas desde el navegador — el backend
 * exige esos headers en rutas protegidas por requireAuthenticated/requireAdmin/requirePermission.
 * Nunca usar desde el navegador.
 */
export async function apiServerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getSession();

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ADMIN_API_TOKEN}`,
      ...(session
        ? {
            "x-admin-user-id": session.sub,
            "x-admin-username": session.username,
            "x-admin-role": session.role,
            "x-admin-permissions": session.permissions.join(","),
            // Restaurante del usuario (no el que pide la pantalla): la API lo usa para que un
            // usuario de restaurante no pueda pedir datos de otro cambiando el otro header.
            ...(session.restaurantId ? { "x-admin-restaurant-id": session.restaurantId } : {}),
          }
        : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Igual que apiServerFetch pero acotado a un restaurante concreto — lo usan las paginas
 * del panel /<slug>. Sin este header la API responde con los datos del restaurante local.
 */
export async function apiServerFetchForRestaurant<T>(
  path: string,
  restaurantId: string,
  init?: RequestInit,
): Promise<T> {
  return apiServerFetch<T>(path, {
    ...init,
    headers: { "x-restaurant-id": restaurantId, ...init?.headers },
  });
}

/**
 * Fetch acotado a un restaurante cuando se sabe cual, y al de siempre cuando no.
 *
 * Es lo que permite que una misma pantalla sirva al panel de la raiz (el restaurante de este
 * deployment) y al de /<slug> sin duplicar el codigo: la pagina recibe restaurantId o no, y
 * la consulta sale marcada o sin marcar.
 */
export async function apiServerFetchScoped<T>(
  path: string,
  restaurantId?: string,
  init?: RequestInit,
): Promise<T> {
  return restaurantId ? apiServerFetchForRestaurant<T>(path, restaurantId, init) : apiServerFetch<T>(path, init);
}

export { API_BASE_URL, ADMIN_API_TOKEN };
