"use client";

import { useState } from "react";
import { apiClientFetch } from "@/lib/apiClient";
import type { Lead, LeadStatus } from "./types";

const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  CLOSED: "Cerrado",
};

const STATUS_COLOR: Record<LeadStatus, string> = {
  NEW: "#2a8f17",
  CONTACTED: "#b8860b",
  CLOSED: "#6b6b70",
};

function waLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

export function LeadsManager({ initialLeads }: { initialLeads: Lead[] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function updateStatus(id: string, status: LeadStatus) {
    setUpdatingId(id);
    try {
      const updated = await apiClientFetch<Lead>(`/platform/leads/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
    } catch {
      // el fetch fallido no cambia el estado local; el usuario puede reintentar
    } finally {
      setUpdatingId(null);
    }
  }

  if (leads.length === 0) {
    return <p className="muted">Todavía no hay leads registrados.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {leads.map((lead) => (
        <div
          key={lead.id}
          style={{
            background: "var(--surface-solid)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 16,
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ minWidth: 220 }}>
            <div style={{ fontWeight: 700 }}>{lead.businessName}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {lead.contactName} · {lead.phone}
              {lead.email ? ` · ${lead.email}` : ""}
            </div>
            {lead.message && (
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {lead.message}
              </div>
            )}
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {new Date(lead.createdAt).toLocaleString("es-CO")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: STATUS_COLOR[lead.status],
                border: `1px solid ${STATUS_COLOR[lead.status]}`,
                borderRadius: 999,
                padding: "3px 10px",
              }}
            >
              {STATUS_LABEL[lead.status]}
            </span>
            <select
              value={lead.status}
              disabled={updatingId === lead.id}
              onChange={(e) => updateStatus(lead.id, e.target.value as LeadStatus)}
              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)" }}
            >
              <option value="NEW">Nuevo</option>
              <option value="CONTACTED">Contactado</option>
              <option value="CLOSED">Cerrado</option>
            </select>
            <a
              href={waLink(lead.phone)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: "linear-gradient(135deg, #3fbf25, #2a8f17)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                padding: "7px 14px",
                borderRadius: 999,
                textDecoration: "none",
              }}
            >
              WhatsApp
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
