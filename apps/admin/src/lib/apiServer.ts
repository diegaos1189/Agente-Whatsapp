const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN ?? "";

/** Fetch server-side (Server Components / Route Handlers) con el token admin. Nunca usar desde el navegador. */
export async function apiServerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ADMIN_API_TOKEN}`,
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

export { API_BASE_URL, ADMIN_API_TOKEN };
