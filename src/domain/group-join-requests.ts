export const GROUP_JOIN_REQUEST_KINDS = ["member_invitation", "participant_link"] as const;
export type GroupJoinRequestKind = typeof GROUP_JOIN_REQUEST_KINDS[number];

export const GROUP_JOIN_REQUEST_STATUSES = ["pending", "accepted", "declined", "revoked", "expired"] as const;
export type GroupJoinRequestStatus = typeof GROUP_JOIN_REQUEST_STATUSES[number];

export const GROUP_JOIN_REQUEST_TTL = 7 * 24 * 60 * 60 * 1000;

export function isGroupJoinRequestKind(value: unknown): value is GroupJoinRequestKind {
  return typeof value === "string" && GROUP_JOIN_REQUEST_KINDS.includes(value as GroupJoinRequestKind);
}

export function isGroupJoinRequestStatus(value: unknown): value is GroupJoinRequestStatus {
  return typeof value === "string" && GROUP_JOIN_REQUEST_STATUSES.includes(value as GroupJoinRequestStatus);
}

export function groupJoinRequestExpiresAt(createdAt: Date) {
  return new Date(createdAt.getTime() + GROUP_JOIN_REQUEST_TTL);
}

export function isGroupJoinRequestExpired(expiresAt: Date, now: Date = new Date()) {
  return now.getTime() >= expiresAt.getTime();
}
