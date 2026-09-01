import { NextRequest, NextResponse } from "next/server";
import { apiServerFetch } from "@/lib/apiServer";

export const dynamic = "force-dynamic";

/**
 * Recibe el formulario "Quiero una demo" de la landing publica (/) y lo reenvia al backend
 * con el ADMIN_API_TOKEN (que nunca se expone al navegador) — igual patron que
 * apps/admin/src/app/api/public-settings/route.ts, pero para escritura en vez de lectura.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Datos invalidos" }, { status: 400 });
  }

  try {
    await apiServerFetch("/api/leads", { method: "POST", body: JSON.stringify(body) });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No se pudo enviar el formulario, intenta de nuevo." }, { status: 502 });
  }
}
