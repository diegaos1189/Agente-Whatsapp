import { Suspense } from "react";
import { apiServerFetch } from "@/lib/apiServer";
import type { BusinessSettingsDTO } from "@pollos/shared";
import { LoginFormClient } from "./LoginFormClient";

async function getLogoUrl(): Promise<string | null> {
  try {
    const settings = await apiServerFetch<BusinessSettingsDTO>("/api/settings");
    return settings.logoUrl;
  } catch {
    return null;
  }
}

export default async function LoginPage() {
  const logoUrl = await getLogoUrl();
  return (
    <Suspense fallback={null}>
      <LoginFormClient logoUrl={logoUrl} />
    </Suspense>
  );
}
