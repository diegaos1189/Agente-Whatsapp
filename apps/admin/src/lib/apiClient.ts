import { getActiveRestaurantId, RESTAURANT_HEADER } from "./restaurantScope";

/** Fetch client-side: siempre pasa por /api/proxy, nunca lleva el token directamente. */
export async function apiClientFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Si el panel abierto es el de un restaurante concreto (/<slug>/...), la llamada va
  // marcada con el suyo; sin header, la API asume el restaurante local.
  const restaurantId = getActiveRestaurantId();

  const res = await fetch(`/api/proxy${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(restaurantId ? { [RESTAURANT_HEADER]: restaurantId } : {}),
      ...init?.headers,
    },
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // Normalmente pasa cuando la sesion vencio y el middleware redirigio a /login (HTML)
    // en vez de dejar pasar la llamada a la API.
    throw new Error("Tu sesion expiro o hubo un error de conexion. Recarga la pagina e inicia sesion de nuevo.");
  }

  if (!res.ok) {
    const body = await res.text();
    let message = `Error ${res.status}: ${body}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // body no era JSON, se usa el mensaje crudo de arriba
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}
