import type { BusinessSettingsDTO } from "@pollos/shared";

async function getSettings(): Promise<BusinessSettingsDTO | null> {
  return null;
}

export default async function LandingPage() {
  const settings = await getSettings();
  return <div>OK {settings ? "with" : "without"} settings</div>;
}
