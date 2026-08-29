import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { groupMemberships, groupParticipants } from "@/db/schema";

export type LockedGroupParticipant = {
  id: string;
  userId: string | null;
  displayName: string | null;
};

export type LockedGroupMembership = {
  participantId: string;
  userId: string;
};

export async function lockGroupFinancialParticipants(database: Database, groupId: string, participantIds: string[]) {
  const ids = [...new Set(participantIds)].sort();
  const participants = await database
    .select({
      id: groupParticipants.id,
      userId: groupParticipants.userId,
      displayName: groupParticipants.displayName,
    })
    .from(groupParticipants)
    .where(and(eq(groupParticipants.groupId, groupId), inArray(groupParticipants.id, ids)))
    .orderBy(asc(groupParticipants.id))
    .for("update");
  const memberships = await database
    .select({ participantId: groupMemberships.participantId, userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.groupId, groupId), inArray(groupMemberships.participantId, ids)))
    .orderBy(asc(groupMemberships.participantId), asc(groupMemberships.userId))
    .for("update");
  return {
    participants: new Map(participants.map((participant) => [participant.id, participant satisfies LockedGroupParticipant])),
    memberships: new Map(memberships.map((membership) => [membership.participantId, membership satisfies LockedGroupMembership])),
  };
}

export function isActiveGroupParticipant(
  participant: LockedGroupParticipant | undefined,
  membership: LockedGroupMembership | undefined,
) {
  return Boolean(participant?.userId && membership?.userId === participant.userId);
}
