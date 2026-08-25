import { canGrantOrganizationInvitationRole, type OrganizationInvitationRole } from "@/domain/organization-permissions";

export const ORGANIZATION_INVITATION_TTL = 7 * 24 * 60 * 60 * 1000;
export type OrganizationInvitationStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

export function organizationInvitationExpiresAt(createdAt: Date) {
  return new Date(createdAt.getTime() + ORGANIZATION_INVITATION_TTL);
}

export function isOrganizationInvitationExpired(expiresAt: Date, now: Date = new Date()) {
  return now.getTime() >= expiresAt.getTime();
}

export { canGrantOrganizationInvitationRole };
export type { OrganizationInvitationRole };
