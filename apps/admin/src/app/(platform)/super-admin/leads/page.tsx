import { apiServerFetch } from "@/lib/apiServer";
import { LeadsManager } from "./LeadsManager";
import type { Lead } from "./types";

export default async function LeadsPage() {
  const leads = await apiServerFetch<Lead[]>("/api/platform/leads").catch(() => []);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Leads</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Negocios que dejaron sus datos desde el formulario de la landing.
        </p>
      </div>
      <LeadsManager initialLeads={leads} />
    </div>
  );
}
