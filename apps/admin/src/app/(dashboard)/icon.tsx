import { apiServerFetch } from "@/lib/apiServer";
import type { BusinessSettingsDTO } from "@pollos/shared";

/**
 * Favicon del panel del restaurante: el logo del negocio (business_settings.logoUrl,
 * guardado como data URL), igual que el que se ve en el sidebar. Por convencion de Next,
 * este icon.tsx aplica solo a las rutas del grupo (dashboard) — el area de plataforma
 * (/super-admin) y el login siguen usando el icono Pedix de app/icon.svg.
 */

// El logo puede cambiar desde Configuracion sin redeploy, asi que nada de estatico.
export const dynamic = "force-dynamic";

/** Respaldo cuando el negocio no subio logo: la P de Pedix (mismo diseño que app/icon.svg). */
const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Pedix">
  <rect width="64" height="64" rx="14" fill="#2fa036"/>
  <text x="32" y="46" text-anchor="middle" font-family="'Baloo 2','Fredoka','Segoe UI',Arial,sans-serif" font-size="42" font-weight="800" fill="#ffffff">P</text>
</svg>`;

function fallbackResponse(): Response {
  return new Response(FALLBACK_SVG, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" },
  });
}

export default async function Icon(): Promise<Response> {
  let logoUrl: string | null = null;
  try {
    const settings = await apiServerFetch<BusinessSettingsDTO>("/api/settings");
    logoUrl = settings.logoUrl;
  } catch {
    // Sin sesion o API caida: se responde el icono generico en vez de romper el favicon.
    return fallbackResponse();
  }
  if (!logoUrl) return fallbackResponse();

  const dataUrl = /^data:([^;,]+);base64,(.+)$/.exec(logoUrl);
  if (dataUrl) {
    return new Response(Buffer.from(dataUrl[2], "base64"), {
      headers: { "Content-Type": dataUrl[1], "Cache-Control": "public, max-age=300" },
    });
  }
  if (/^https?:\/\//.test(logoUrl)) {
    return Response.redirect(logoUrl, 302);
  }
  return fallbackResponse();
}
