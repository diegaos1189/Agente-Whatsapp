import { ConversationStatus } from "@pollos/shared";

export type ConversationSenderType = "CUSTOMER" | "BOT" | "HUMAN" | "SYSTEM";

export interface ConversationOwnershipSnapshot {
  status: string;
  isHandoff: boolean;
  assignedAdminUserId: string | null;
}

export function isHumanHandoffStatus(status: string): boolean {
  return status === ConversationStatus.WAITING_HUMAN || status === ConversationStatus.HUMAN;
}

export function canBotAutoReply(snapshot: ConversationOwnershipSnapshot): boolean {
  if (snapshot.isHandoff) return false;
  return !isHumanHandoffStatus(snapshot.status);
}

export function shouldAcknowledgeHumanRequest(snapshot: ConversationOwnershipSnapshot): boolean {
  return canBotAutoReply(snapshot);
}

export function canAdminTakeConversation(snapshot: ConversationOwnershipSnapshot): boolean {
  return snapshot.status === ConversationStatus.WAITING_HUMAN && !snapshot.assignedAdminUserId;
}

export function isOwnedByAdmin(snapshot: ConversationOwnershipSnapshot, adminUserId: string): boolean {
  return snapshot.status === ConversationStatus.HUMAN && snapshot.assignedAdminUserId === adminUserId;
}

export function canAdminReply(snapshot: ConversationOwnershipSnapshot, adminUserId: string): boolean {
  return isOwnedByAdmin(snapshot, adminUserId);
}

export function mapInboundSenderType(): ConversationSenderType {
  return "CUSTOMER";
}

export function mapAutomatedOutboundSenderType(): ConversationSenderType {
  return "BOT";
}
