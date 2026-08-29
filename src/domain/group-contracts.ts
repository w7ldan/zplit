import type { GroupJoinRequestKind, GroupJoinRequestStatus } from "./group-join-requests";
import type { GroupRole } from "./group-permissions";
import type { PaymentMethodChoice } from "./payment-method";

export type GroupCapabilities = {
  isOwner: boolean;
  canManageGroup: boolean;
  canManageParticipants: boolean;
  canManageRoles: boolean;
  canDelete: boolean;
};

export type GroupAvatarMetadata = { mediaType: "image/webp"; byteSize: number; sha256: string };

export type GroupSummary = {
  id: string;
  name: string;
  description: string | null;
  role: GroupRole;
  participantCount: number;
  avatar: GroupAvatarMetadata | null;
};

export type GroupDetail = GroupSummary & GroupCapabilities & {
  memberCount: number;
  externalParticipantCount: number;
};

export type GroupParticipant = {
  id: string;
  userId: string | null;
  displayName: string;
  label: string | null;
  role: GroupRole | null;
  isExternal: boolean;
  isFormer: boolean;
};

export type GroupParticipantEligibility = {
  id: string;
  userId: string | null;
  displayName: string | null;
  label: string | null;
  status: "active" | "former" | "external";
  canCreate: boolean;
  canPay: boolean;
  canParticipate: boolean;
  canBeCreditor: boolean;
};

export type GroupJoinRequestSummary = {
  id: string;
  kind: GroupJoinRequestKind;
  status: GroupJoinRequestStatus;
  targetUserId: string;
  targetDisplayName: string;
  targetUsername: string;
  participantId: string | null;
  participantDisplayName: string | null;
  participantLabel: string | null;
  expiresAt: string;
};

export type GroupFormValues = { name: string; description: string };
export type GroupActionState = { fieldErrors: Partial<Record<keyof GroupFormValues | "avatar", string>>; formError: string; values: GroupFormValues };
export type GroupJoinRequestActionState = { error: string; values: { username: string } };

export type GroupExpenseShareFormValue = { participantId: string; amount: string };
export type GroupExpenseFormValues = { description: string; totalAmount: string; occurredAtLocal: string; timezoneOffsetMinutes: string; payerParticipantId: string; shares: GroupExpenseShareFormValue[] };
export type GroupExpenseActionState = { fieldErrors: Partial<Record<"description" | "totalAmount" | "occurredAtLocal" | "payerParticipantId" | "shares", string>>; formError: string; values: GroupExpenseFormValues };
export type GroupExpenseConfirmationState = { error: string; success?: string };
export type GroupSettlementFormValues = {
  recipientParticipantId: string;
  amountRupiah: string;
  paymentMethodChoice: PaymentMethodChoice;
  paymentMethodOther: string;
};
export type GroupSettlementActionState = {
  fieldErrors: Partial<Record<keyof GroupSettlementFormValues | "proof", string>>;
  formError: string;
  values: GroupSettlementFormValues;
};
export type GroupSettlementConfirmationState = { error: string; success?: string };
export type GroupOffsetFormValues = { counterpartyParticipantId: string };
export type GroupOffsetActionState = { error: string; values: GroupOffsetFormValues };
export type GroupOffsetConfirmationState = { error: string; success?: string };
export type GroupOffsetCounterpartyOption = {
  id: string;
  displayName: string;
  label: string | null;
  offsetAmount: number;
};
export type GroupSettlementRecipientOption = {
  id: string;
  displayName: string;
  label: string | null;
  currentDebt: number;
};
