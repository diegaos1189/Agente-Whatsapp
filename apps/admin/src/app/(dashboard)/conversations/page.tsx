import Link from "next/link";
import { apiServerFetch } from "@/lib/apiServer";
import type { ConversationSummaryDTO } from "@pollos/shared";
import { ArchiveButton } from "./ArchiveButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SearchBox } from "@/components/SearchBox";

function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const conversations = await apiServerFetch<ConversationSummaryDTO[]>("/api/conversations");

  const query = q?.trim().toLowerCase();
  const filtered = query
    ? conversations.filter(
        (c) => c.phone.includes(query) || (c.customerName ?? "").toLowerCase().includes(query),
      )
    : conversations;

  return (
    <div>
      <AutoRefresh intervalMs={8000} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Conversaciones</h2>
        <SearchBox placeholder="Buscar por número o nombre..." />
      </div>

      <div className="wa-chat-list" style={{ marginTop: 16 }}>
        {filtered.map((c) => (
          <div key={c.id} className="wa-chat-row">
            <Link href={`/conversations/${c.id}`} className="wa-chat-link">
              <div className={`wa-avatar${c.isHandoff ? " wa-avatar-handoff" : ""}`}>{initialsOf(c.customerName)}</div>
              <div className="wa-chat-main">
                <div className="wa-chat-name">{c.customerName || c.phone}</div>
                <div className="wa-chat-preview">
                  {c.customerName ? `${c.phone} · ` : ""}
                  {c.lastMessagePreview ?? "Sin mensajes"}
                </div>
                {c.assignedAdminUsername && <div className="wa-chat-preview">Asignada a {c.assignedAdminUsername}</div>}
              </div>
              <div className="wa-chat-meta">
                <span className="wa-chat-time">
                  {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString("es-419", { hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
                {c.status === "WAITING_HUMAN" ? (
                  <span className="pill pill-danger">
                    <span className="badge-pulse-dot" />
                    Esperando
                  </span>
                ) : c.status === "HUMAN" ? (
                  <span className="pill pill-danger">En atención</span>
                ) : (
                  <span className="pill pill-success">Bot</span>
                )}
              </div>
            </Link>
            <div style={{ marginRight: 16, flexShrink: 0 }}>
              <ArchiveButton conversationId={c.id} />
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="muted" style={{ padding: 16 }}>Aún no hay conversaciones.</p>}
      </div>
    </div>
  );
}
