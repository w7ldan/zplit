import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { groupParticipants, groupMemberships, users } from "@/db/schema";
import type { GroupParticipantEligibility } from "@/domain/group-contracts";

export type GroupParticipantPresentation = {
  id: string;
  userId: string | null;
  displayName: string;
  label: string | null;
  status: "active" | "former" | "external";
};

export function fallbackParticipant(id: string): GroupParticipantPresentation {
  return { id, userId: null, displayName: "Participant", label: null, status: "former" };
}

function participantQuery(database: Database) {
  return database
    .select({
      id: groupParticipants.id,
      userId: groupParticipants.userId,
      externalName: groupParticipants.displayName,
      label: groupParticipants.label,
      userName: users.name,
      membershipUserId: groupMemberships.userId,
    })
    .from(groupParticipants)
    .leftJoin(users, eq(users.id, groupParticipants.userId))
    .leftJoin(
      groupMemberships,
      and(
        eq(groupMemberships.groupId, groupParticipants.groupId),
        eq(groupMemberships.participantId, groupParticipants.id),
      ),
    );
}

export async function loadParticipantMap(database: Database, groupId: string, participantIds: string[]) {
  const ids = [...new Set(participantIds)];
  if (ids.length === 0) return new Map<string, GroupParticipantPresentation>();
  const rows = await participantQuery(database)
    .where(and(eq(groupParticipants.groupId, groupId), inArray(groupParticipants.id, ids)));
  return new Map(rows.map((row) => [row.id, presentParticipant(row)]));
}

export async function listActiveGroupUserIds(database: Database, groupId: string) {
  const rows = await database
    .select({ userId: groupMemberships.userId })
    .from(groupMemberships)
    .where(eq(groupMemberships.groupId, groupId));
  return rows.map(({ userId }) => userId);
}

function presentParticipant(row: Awaited<ReturnType<typeof participantQuery>>[number]): GroupParticipantPresentation {
  const status = row.userId === null ? "external" : row.membershipUserId ? "active" : "former";
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.userName ?? row.externalName ?? "Participant",
    label: row.label,
    status,
  };
}

export async function readGroupParticipantEligibility(database: Database, groupId: string): Promise<GroupParticipantEligibility[]> {
  const rows = await participantQuery(database)
    .where(eq(groupParticipants.groupId, groupId))
    .orderBy(asc(groupParticipants.userId), asc(groupParticipants.displayName), asc(groupParticipants.id));
  return rows.map((row) => {
    const participant = presentParticipant(row);
    return {
      ...participant,
      canCreate: participant.status === "active",
      canPay: participant.status === "active",
      canParticipate: participant.status !== "former",
      canBeCreditor: participant.status === "active",
    };
  });
}

export async function listActiveRegisteredGroupParticipants(database: Database, groupId: string) {
  const rows = await database
    .select({ id: groupParticipants.id, label: groupParticipants.label, externalName: groupParticipants.displayName, userName: users.name })
    .from(groupParticipants)
    .innerJoin(groupMemberships, and(
      eq(groupMemberships.groupId, groupParticipants.groupId),
      eq(groupMemberships.participantId, groupParticipants.id),
      eq(groupMemberships.userId, groupParticipants.userId),
    ))
    .leftJoin(users, eq(users.id, groupParticipants.userId))
    .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.userId, groupMemberships.userId)))
    .orderBy(asc(groupParticipants.id));
  return rows.map((row) => ({
    id: row.id,
    displayName: row.userName ?? row.externalName ?? "Group member",
    label: row.label,
  }));
}
