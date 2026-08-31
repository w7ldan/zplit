import type { OrganizationInvitationRole, OrganizationRole } from "./organization-permissions";

export type OrganizationCapabilities = {
  canUpdate: boolean;
  canDelete: boolean;
  canViewMembers: boolean;
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
};

export type OrganizationDetail = OrganizationSummary & OrganizationCapabilities;

export type OrganizationMember = {
  id: string;
  displayName: string;
  username: string | null;
  role: OrganizationRole;
};

export type OrganizationInvitationSummary = {
  id: string;
  targetUserId: string;
  displayName: string;
  username: string;
  role: OrganizationInvitationRole;
  expiresAt: string;
};

export type OrganizationFormValues = { name: string; description: string };
export type OrganizationActionState = { fieldErrors: Partial<Record<keyof OrganizationFormValues | "avatar", string>>; formError: string; values: OrganizationFormValues };
export type OrganizationInvitationActionState = { error: string; values: { targetUserId: string; role: OrganizationInvitationRole } };
