import { apiServerFetchScoped } from "@/lib/apiServer";
import type { ConversationDetailDTO, MessageDTO } from "@pollos/shared";
import { ResolveHandoffButton } from "./ResolveHandoffButton";
import { EscalateButton } from "./EscalateButton";
import { ReplyBox } from "./ReplyBox";
import { OrderPanel } from "./OrderPanel";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ChatImage } from "./ChatImage";
import { ChatThread } from "./ChatThread";
import { TakeConversationButton } from "./TakeConversationButton";
import { ArchiveButton } from "../ArchiveButton";

function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-419", { hour: "2-digit", minute: "2-digit" });
}

export async function ConversationDetailView({
  conversationId: id,
  restaurantId,
}: {
  conversationId: string;
  /** Restaurante del panel abierto. Sin valor = el restaurante de este deployment. */
  restaurantId?: string;
}) {
  const [conversation, messages] = await Promise.all([
    apiServerFetchScoped<ConversationDetailDTO>(`/api/conversations/${id}`, restaurantId),
    apiServerFetchScoped<MessageDTO[]>(`/api/conversations/${id}/messages`, restaurantId),
  ]);
  const humanActive = conversation.status === "HUMAN";
  const waitingHuman = conversation.status === "WAITING_HUMAN";

  return (
    <div>
      <AutoRefresh intervalMs={4000} />
      <h2>Conversacion</h2>
      <div className="conv-detail-layout">
        <div style={{ minWidth: 0 }}>
          <div className="chat-header">
            <div className={`wa-avatar${conversation.isHandoff ? " wa-avatar-handoff" : ""}`}>
              {initialsOf(conversation.customerName)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="chat-header-name">{conversation.customerName ?? "Cliente"}</div>
              <div className="chat-header-phone">{conversation.phone}</div>
              <div className="muted" style={{ marginTop: 4 }}>
                Estado: {conversation.status}
                {conversation.assignedAdminUsername ? ` · Asignada a ${conversation.assignedAdminUsername}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {waitingHuman ? <TakeConversationButton conversationId={id} /> : null}
              {humanActive ? <ResolveHandoffButton conversationId={id} /> : null}
              {!conversation.isHandoff ? <EscalateButton conversationId={id} /> : null}
              <ArchiveButton conversationId={id} />
            </div>
          </div>
          <ChatThread lastMessageId={messages[messages.length - 1]?.id ?? null}>
            {messages.map((m) => (
              <div key={m.id} className={`chat-bubble ${m.direction === "INBOUND" ? "inbound" : "outbound"}`}>
                {m.direction === "OUTBOUND" && m.senderType && (
                  <div className="muted" style={{ marginBottom: 4, fontSize: 12 }}>
                    {m.senderType === "HUMAN" ? `Asesor${m.adminUsername ? `: ${m.adminUsername}` : ""}` : m.senderType}
                  </div>
                )}
                <div>{m.body}</div>
                {m.type === "AUDIO" && m.mediaUrl && (
                  <audio controls src={m.mediaUrl} style={{ marginTop: 6, maxWidth: 240, height: 32 }} />
                )}
                {m.type === "IMAGE" && m.mediaUrl && <ChatImage mediaUrl={m.mediaUrl} messageId={m.id} />}
                <div className="chat-bubble-time">{formatTime(m.createdAt)}</div>
              </div>
            ))}
            {messages.length === 0 && <p className="muted">Aun no hay mensajes en esta conversacion.</p>}
          </ChatThread>
          <ReplyBox
            conversationId={id}
            disabled={!humanActive}
            disabledReason={
              waitingHuman ? "Toma la conversacion para responder." : "El bot esta activo. Escala o toma la conversacion si necesitas responder."
            }
          />
        </div>
        <div className="conv-detail-order" style={{ minWidth: 0 }}>
          <OrderPanel contactId={conversation.contactId} conversationId={id} pendingOrder={conversation.pendingOrder} />
        </div>
      </div>
    </div>
  );
}
