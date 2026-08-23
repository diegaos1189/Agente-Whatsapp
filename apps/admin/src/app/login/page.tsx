import { Suspense } from "react";
import { apiServerFetch } from "@/lib/apiServer";
import type { PublicSettingsDTO } from "../api/public-settings/route";
import { LoginFormClient } from "./LoginFormClient";

async function getLogoUrl(): Promise<string | null> {
  try {
    const settings = await apiServerFetch<PublicSettingsDTO>("/api/public-settings");
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
