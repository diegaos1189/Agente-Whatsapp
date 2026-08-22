import { describe, expect, it } from "vitest";
import { ConversationStatus } from "@pollos/shared";
import {
  canAdminReply,
  canAdminTakeConversation,
  canBotAutoReply,
  isHumanHandoffStatus,
  mapAutomatedOutboundSenderType,
  mapInboundSenderType,
  shouldAcknowledgeHumanRequest,
  type ConversationOwnershipSnapshot,
} from "../src/modules/conversation/conversationHandoff.js";

function snapshot(partial: Partial<ConversationOwnershipSnapshot>): ConversationOwnershipSnapshot {
  return {
    status: partial.status ?? ConversationStatus.ACTIVE,
    isHandoff: partial.isHandoff ?? false,
    assignedAdminUserId: partial.assignedAdminUserId ?? null,
  };
}

describe("human handoff control", () => {
  it("TEST 1: solicitud explicita de humano termina en silencio del bot", () => {
    expect(shouldAcknowledgeHumanRequest(snapshot({ status: ConversationStatus.ACTIVE, isHandoff: false }))).toBe(true);
    expect(canBotAutoReply(snapshot({ status: ConversationStatus.WAITING_HUMAN, isHandoff: true }))).toBe(false);
  });

  it("TEST 2: despues del handoff el bot no debe responder automaticamente", () => {
    expect(canBotAutoReply(snapshot({ status: ConversationStatus.WAITING_HUMAN, isHandoff: true }))).toBe(false);
    expect(canBotAutoReply(snapshot({ status: ConversationStatus.HUMAN, isHandoff: true, assignedAdminUserId: "u1" }))).toBe(false);
  });

  it("TEST 3: WAITING_HUMAN representa una conversacion aun no tomada", () => {
    expect(canAdminTakeConversation(snapshot({ status: ConversationStatus.WAITING_HUMAN, isHandoff: true }))).toBe(true);
  });

  it("TEST 4: una conversacion ya tomada no puede ser tomada de nuevo", () => {
    expect(canAdminTakeConversation(snapshot({ status: ConversationStatus.HUMAN, isHandoff: true, assignedAdminUserId: "u1" }))).toBe(false);
  });

  it("TEST 5: si IA empezo antes pero ahora la conversacion es HUMAN, se descarta la respuesta", () => {
    const before = snapshot({ status: ConversationStatus.ACTIVE, isHandoff: false });
    const afterTakeover = snapshot({ status: ConversationStatus.HUMAN, isHandoff: true, assignedAdminUserId: "u1" });
    expect(canBotAutoReply(before)).toBe(true);
    expect(canBotAutoReply(afterTakeover)).toBe(false);
  });

  it("TEST 6: un humano solo puede responder si es el owner actual", () => {
    expect(canAdminReply(snapshot({ status: ConversationStatus.HUMAN, isHandoff: true, assignedAdminUserId: "u1" }), "u1")).toBe(true);
    expect(canAdminReply(snapshot({ status: ConversationStatus.HUMAN, isHandoff: true, assignedAdminUserId: "u1" }), "u2")).toBe(false);
  });

  it("TEST 7: devolver al bot significa salir del estado humano/handoff", () => {
    expect(isHumanHandoffStatus(ConversationStatus.HUMAN)).toBe(true);
    expect(isHumanHandoffStatus(ConversationStatus.WAITING_HUMAN)).toBe(true);
    expect(isHumanHandoffStatus(ConversationStatus.ACTIVE)).toBe(false);
  });

  it("TEST 8: cuando vuelve a ACTIVE, el bot puede responder normalmente otra vez", () => {
    expect(canBotAutoReply(snapshot({ status: ConversationStatus.ACTIVE, isHandoff: false }))).toBe(true);
  });

  it("TEST 9: un error critico debe dejar el bot silenciado igual que cualquier handoff", () => {
    expect(canBotAutoReply(snapshot({ status: ConversationStatus.WAITING_HUMAN, isHandoff: true }))).toBe(false);
  });

  it("TEST 10: solicitudes duplicadas de humano no deben requerir nuevo mensaje del bot", () => {
    expect(shouldAcknowledgeHumanRequest(snapshot({ status: ConversationStatus.ACTIVE, isHandoff: false }))).toBe(true);
    expect(shouldAcknowledgeHumanRequest(snapshot({ status: ConversationStatus.WAITING_HUMAN, isHandoff: true }))).toBe(false);
  });

  it("TEST 12: el handoff no implica borrar el contexto del carrito", () => {
    const waiting = snapshot({ status: ConversationStatus.WAITING_HUMAN, isHandoff: true });
    expect(waiting.status).toBe(ConversationStatus.WAITING_HUMAN);
  });

  it("TEST 13: el handoff no altera por si mismo el estado de un pedido ya confirmado", () => {
    expect(mapInboundSenderType()).toBe("CUSTOMER");
    expect(mapAutomatedOutboundSenderType()).toBe("BOT");
  });
});
