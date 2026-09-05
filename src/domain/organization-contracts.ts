import type { OrganizationInvitationRole, OrganizationRole } from "./organization-permissions";

export type OrganizationCapabilities = {
  canUpdate: boolean;
  canDelete: boolean;
  canViewMembers: boolean;
  canManageMembers: boolean;
  canViewLedger: boolean;
  canManageFriends: boolean;
  canViewChat: boolean;
  canManageRepaymentDestinations: boolean;
  canExport: boolean;
  invitationRoles: OrganizationInvitationRole[];
};

export type OrganizationAvatarMetadata = { mediaType: "image/webp"; byteSize: number; sha256: string };

export type OrganizationSummary = {
  id: string;
  name: string;
  description: string | null;
  role: OrganizationRole;
  memberCount: number;
  avatar: OrganizationAvatarMetadata | null;
  archivedAt: string | null;
};

export type OrganizationDetail = OrganizationSummary & OrganizationCapabilities;

export type OrganizationMember = {
  id: string;
  userId: string | null;
  displayName: string;
  username: string | null;
  label: string | null;
  role: OrganizationRole | null;
  isLocal: boolean;
};

export type OrganizationInvitationSummary = {
  id: string;
  participantId: string | null;
  targetUserId: string;
  displayName: string;
  username: string;
  role: OrganizationInvitationRole;
  expiresAt: string;
};

export type OrganizationFormValues = { name: string; description: string };
export type OrganizationActionState = { fieldErrors: Partial<Record<keyof OrganizationFormValues | "avatar", string>>; formError: string; values: OrganizationFormValues };
export type OrganizationInvitationActionState = { error: string; values: { targetUserId: string; role: OrganizationInvitationRole } };
