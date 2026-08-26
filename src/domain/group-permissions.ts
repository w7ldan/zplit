export const GROUP_ROLES = ["owner", "admin", "member"] as const;
export type GroupRole = typeof GROUP_ROLES[number];

export function isGroupRole(value: unknown): value is GroupRole {
  return typeof value === "string" && GROUP_ROLES.includes(value as GroupRole);
}

export function groupAccessForRole(role: GroupRole) {
  return {
    isOwner: role === "owner",
    canManageGroup: role === "owner" || role === "admin",
    canManageParticipants: role === "owner" || role === "admin",
    canManageRoles: role === "owner",
    canDelete: role === "owner",
  } as const;
}
