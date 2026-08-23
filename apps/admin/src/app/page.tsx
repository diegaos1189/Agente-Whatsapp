import { apiServerFetch } from "@/lib/apiServer";
import type { BusinessSettingsDTO } from "@pollos/shared";

async function getSettings(): Promise<BusinessSettingsDTO | null> {
  try {
    return await apiServerFetch<BusinessSettingsDTO>("/api/settings");
  } catch {
    return null;
  }
}

export default async function LandingPage() {
  const settings = await getSettings();
  return <div>OK {settings ? "with" : "without"} settings, name={settings?.restaurantName}</div>;
}
