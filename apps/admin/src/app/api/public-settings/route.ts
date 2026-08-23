import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/apiServer";
import type { BusinessSettingsDTO } from "@pollos/shared";

export const dynamic = "force-dynamic";

/** Subconjunto publico de business_settings para la landing page (sin autenticacion). */
export type PublicSettingsDTO = {
  restaurantName: string;
  logoUrl: string | null;
  phone: string;
  address: string;
  openingHours: BusinessSettingsDTO["openingHours"];
  acceptsDelivery: boolean;
};

export async function GET() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/public-settings`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json(null, { status: 200 });
    const publicSettings: PublicSettingsDTO = await res.json();
    return NextResponse.json(publicSettings);
  } catch {
    return NextResponse.json(null, { status: 200 });
  }
}
