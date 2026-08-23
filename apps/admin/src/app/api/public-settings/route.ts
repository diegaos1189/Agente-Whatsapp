import { NextResponse } from "next/server";
import { apiServerFetch } from "@/lib/apiServer";
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
    const settings = await apiServerFetch<BusinessSettingsDTO>("/api/settings");
    const publicSettings: PublicSettingsDTO = {
      restaurantName: settings.restaurantName,
      logoUrl: settings.logoUrl,
      phone: settings.phone,
      address: settings.address,
      openingHours: settings.openingHours,
      acceptsDelivery: settings.acceptsDelivery,
    };
    return NextResponse.json(publicSettings);
  } catch {
    return NextResponse.json(null, { status: 200 });
  }
}
