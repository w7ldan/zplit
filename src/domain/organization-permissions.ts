export const ORGANIZATION_CAPABILITIES = [
  "organization.view",
  "organization.update",
  "organization.delete",
  "members.view",
  "members.invite",
  "members.manage",
  "roles.manage",
  "ledger.view",
  "friends.manage",
  "trips.manage",
  "outings.manage",
  "expenses.create",
  "expenses.edit",
  "expenses.delete",
  "repayments.create",
  "repayments.edit",
  "repayments.delete",
  "repayment_destinations.manage",
  "exports.create",
  "chat.view",
  "chat.send",
  "chat.moderate",
] as const;

export type OrganizationCapability = typeof ORGANIZATION_CAPABILITIES[number];
export const ORGANIZATION_ROLES = ["owner", "admin", "treasurer", "member", "custom"] as const;
export type OrganizationRole = typeof ORGANIZATION_ROLES[number];
export const ORGANIZATION_INVITATION_ROLES = ["admin", "treasurer", "member"] as const;
export type OrganizationInvitationRole = typeof ORGANIZATION_INVITATION_ROLES[number];

export const ORGANIZATION_OWNER_RESERVED_CAPABILITIES = ["organization.delete"] as const satisfies readonly OrganizationCapability[];

const capabilitySet = new Set<string>(ORGANIZATION_CAPABILITIES);
const ownerReservedCapabilities = new Set<string>(ORGANIZATION_OWNER_RESERVED_CAPABILITIES);
const presetCapabilities: Record<Exclude<OrganizationRole, "custom">, readonly OrganizationCapability[]> = {
  owner: ORGANIZATION_CAPABILITIES,
  admin: ORGANIZATION_CAPABILITIES.filter((capability) => !ownerReservedCapabilities.has(capability)),
  treasurer: [
    "organization.view",
    "members.view",
    "ledger.view",
    "friends.manage",
    "trips.manage",
    "outings.manage",
    "expenses.create",
    "expenses.edit",
    "expenses.delete",
    "repayments.create",
    "repayments.edit",
    "repayments.delete",
    "repayment_destinations.manage",
    "exports.create",
    "chat.view",
    "chat.send",
  ],
  member: ["organization.view", "members.view", "ledger.view", "chat.view", "chat.send"],
};

export function isOrganizationCapability(value: unknown): value is OrganizationCapability {
  return typeof value === "string" && capabilitySet.has(value);
}

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function isOrganizationInvitationRole(value: unknown): value is OrganizationInvitationRole {
  return typeof value === "string" && (ORGANIZATION_INVITATION_ROLES as readonly string[]).includes(value);
}

export function normalizeCustomCapabilities(value: unknown): OrganizationCapability[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((capability): capability is OrganizationCapability => isOrganizationCapability(capability) && !ownerReservedCapabilities.has(capability)))];
}

export function resolveOrganizationCapabilities(role: unknown, customCapabilities?: unknown): ReadonlySet<OrganizationCapability> {
  if (!isOrganizationRole(role)) return new Set<OrganizationCapability>();
  const grants: readonly OrganizationCapability[] = role === "custom" ? ["organization.view", ...normalizeCustomCapabilities(customCapabilities)] : presetCapabilities[role];
  return new Set<OrganizationCapability>(grants);
}

export function canGrantOrganizationInvitationRole(role: unknown, can: (capability: OrganizationCapability) => boolean) {
  if (!isOrganizationInvitationRole(role) || !can("members.invite")) return false;
  if (role === "member") return true;
  return can("roles.manage") && [...resolveOrganizationCapabilities(role)].every(can);
}

export function getOrganizationInvitationRoles(can: (capability: OrganizationCapability) => boolean): OrganizationInvitationRole[] {
  return ORGANIZATION_INVITATION_ROLES.filter((role) => canGrantOrganizationInvitationRole(role, can));
}
