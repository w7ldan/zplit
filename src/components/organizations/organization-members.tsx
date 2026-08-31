"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { SearchableCombobox, type SearchableOption } from "@/components/records/searchable-combobox";
import { UserAvatar } from "@/components/identity/user-avatar";
import type { OrganizationInvitationRole } from "@/domain/organization-permissions";
import type { OrganizationInvitationActionState, OrganizationInvitationSummary, OrganizationMember } from "@/domain/organization-contracts";
import {
  addPersonalFriendAsOrganizationExpenseContactAction,
  createLocalOrganizationParticipantAction,
  createOrganizationInvitationAction,
  revokeOrganizationInvitationAction,
  searchOrganizationInvitationOptions,
  searchOrganizationInvitationUserOptions,
} from "@/app/app/organizations/actions";

function roleLabel(role: string | null) {
  return role ? role[0]?.toUpperCase() + role.slice(1) : "";
}

const initialState: OrganizationInvitationActionState = {
  error: "",
  values: { targetUserId: "", role: "member" },
};

function ParticipantAccessControl({
  organizationId,
  participant,
  pending,
  invitationRoles,
}: {
  organizationId: string;
  participant: OrganizationMember;
  pending?: OrganizationInvitationSummary;
  invitationRoles: OrganizationInvitationRole[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    createOrganizationInvitationAction.bind(null, organizationId),
    initialState,
  );
  const search = searchOrganizationInvitationUserOptions.bind(null, organizationId) as (query: string, selectedId?: string) => Promise<SearchableOption[]>;

  if (pending) {
    return (
      <div className="organization-members__role">
        Pending access · @{pending.username}
        <form action={revokeOrganizationInvitationAction.bind(null, organizationId, pending.id)}>
          <button className="text-link" type="submit">Revoke</button>
        </form>
      </div>
    );
  }

  if (participant.userId) {
    return (
      <form className="organization-members__friend-invite" action={formAction}>
        <input type="hidden" name="targetUserId" value={participant.userId} />
        <input type="hidden" name="participantId" value={participant.id} />
        <select name="role" defaultValue="member" aria-label={`Role for ${participant.displayName}`}>
          {invitationRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
        </select>
        <button className="text-link" type="submit">Invite account</button>
        {state.error ? <span role="alert">{state.error}</span> : null}
      </form>
    );
  }

  if (!open) {
    return (
      <button className="text-link" type="button" onClick={() => setOpen(true)}>
        Link Zplit account
      </button>
    );
  }

  return (
    <form className="organization-people__link-form" action={formAction}>
      <label className="sr-only" id={`organization-link-${participant.id}-label`} htmlFor={`organization-link-${participant.id}`}>
        Search account for {participant.displayName}
      </label>
      <SearchableCombobox
        id={`organization-link-${participant.id}`}
        name="targetUserId"
        options={[]}
        search={search}
        required
        placeholder="Search by @username"
        searchLabel="Search by @username"
        labelId={`organization-link-${participant.id}-label`}
      />
      <input type="hidden" name="participantId" value={participant.id} />
      <select name="role" defaultValue="member" aria-label={`Role for ${participant.displayName}`}>
        {invitationRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
      </select>
      <button className="text-link" type="submit">Invite account</button>
      <button className="text-link" type="button" onClick={() => setOpen(false)}>Cancel</button>
      {state.error ? <span role="alert">{state.error}</span> : null}
    </form>
  );
}

function friendIdentity(candidate: { displayName: string; username: string | null; label: string | null; userId: string | null }) {
  return (
    <span className="organization-members__friend-identity">
      {candidate.userId ? <UserAvatar userId={candidate.userId} size="sm" decorative /> : null}
      <span className="organization-members__identity">
        <strong>{candidate.displayName}</strong>
        <span>{candidate.username ? `@${candidate.username} · Zplit friend` : candidate.label ?? "Local friend"}</span>
      </span>
    </span>
  );
}

export function OrganizationMembers({
  organizationId,
  members,
  pendingInvitations,
  invitationRoles,
  canManageMembers,
  expenseFriendCandidates = [],
  canViewExpenseContacts = false,
  canManageExpenseContacts = false,
}: {
  organizationId: string;
  members?: OrganizationMember[];
  pendingInvitations: OrganizationInvitationSummary[];
  invitationRoles: OrganizationInvitationRole[];
  canManageMembers: boolean;
  expenseFriendCandidates?: Array<{ personalFriendId: string; userId: string | null; displayName: string; username: string | null; label: string | null }>;
  canViewExpenseContacts?: boolean;
  canManageExpenseContacts?: boolean;
}) {
  const [state, formAction] = useActionState(
    createOrganizationInvitationAction.bind(null, organizationId),
    initialState,
  );
  const search = searchOrganizationInvitationOptions.bind(null, organizationId) as (query: string, selectedId?: string) => Promise<SearchableOption[]>;
  const canInvite = invitationRoles.length > 0;
  const pendingByParticipant = new Map(pendingInvitations.flatMap((invitation) => invitation.participantId ? [[invitation.participantId, invitation] as const] : []));

  return (
    <>
      {members ? (
        <section className="organization-detail__section" aria-labelledby="organization-members-heading">
          <h2 id="organization-members-heading">Members</h2>
          <ul className="organization-members__list">
            {members.map((member) => (
              <li className="organization-members__row" key={member.id}>
                {member.userId && member.role ? <UserAvatar userId={member.userId} size="sm" alt={`${member.displayName} avatar`} /> : <span aria-hidden="true" />}
                <span className="organization-members__identity">
                  <strong>{member.displayName}</strong>
                  {member.username ? <span>@{member.username}</span> : member.label ? <span>{member.label}</span> : null}
                  <span>{member.role ? `${roleLabel(member.role)} · Zplit member` : member.userId ? "Registered identity · No access" : "Local member"}</span>
                </span>
                {member.role ? null : canInvite ? (
                  <ParticipantAccessControl
                    organizationId={organizationId}
                    participant={member}
                    pending={pendingByParticipant.get(member.id)}
                    invitationRoles={invitationRoles}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canInvite || canManageMembers ? (
        <section className="organization-detail__section" aria-labelledby="organization-add-member-heading">
          <h2 id="organization-add-member-heading">Add member</h2>
          <form className="organization-invite__form" action={formAction}>
            <label id="organization-member-target-label" htmlFor="organization-member-target">
              Search by name or @username...
            </label>
            <SearchableCombobox
              id="organization-member-target"
              name="targetUserId"
              value={state.values.targetUserId}
              options={[]}
              search={search}
              required
              placeholder="Search by name or @username..."
              searchLabel="Search by name or @username..."
              labelId="organization-member-target-label"
            />
            {canInvite ? (
              <>
                <label htmlFor="organization-member-role">Role for registered account</label>
                <select id="organization-member-role" name="role" defaultValue={state.values.role}>
                  {invitationRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                </select>
              </>
            ) : null}
            <p className="organization-invite__message" role={state.error && !state.error.endsWith("sent.") && !state.error.endsWith("added.") ? "alert" : "status"}>
              {state.error || "Search for a Personal Friend or Zplit username."}
            </p>
            <button className="action-link action-link--primary" type="submit">Add member</button>
          </form>
          <p className="organization-detail__supporting-copy">
            No matching person? <Link href="/app/friends?create=1">Add a Personal Friend first.</Link>
          </p>
          {canInvite && pendingInvitations.length > 0 ? (
            <div className="organization-invite__pending">
              <h3>Pending invitations</h3>
              <ul className="organization-members__list">
                {pendingInvitations.map((invitation) => (
                  <li className="organization-members__row" key={invitation.id}>
                    <span className="organization-members__identity">
                      <strong>{invitation.displayName}</strong>
                      <span>@{invitation.username}</span>
                    </span>
                    <span className="organization-members__role">
                      {roleLabel(invitation.role)} · Expires <LocalDateTime iso={invitation.expiresAt} mode="date" />
                    </span>
                    <form action={revokeOrganizationInvitationAction.bind(null, organizationId, invitation.id)}>
                      <button className="text-link" type="submit">Revoke</button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {canManageMembers ? (
        <section className="organization-detail__section" aria-labelledby="organization-local-member-heading">
          <h2 id="organization-local-member-heading">Add local member</h2>
          <form className="organization-invite__form" action={createLocalOrganizationParticipantAction.bind(null, organizationId)}>
            <label htmlFor="organization-local-member-name">Name</label>
            <input id="organization-local-member-name" name="displayName" required />
            <label htmlFor="organization-local-member-label">Label (optional)</label>
            <input id="organization-local-member-label" name="label" />
            <button className="action-link action-link--quiet" type="submit">Add member</button>
          </form>
        </section>
      ) : null}

      {canViewExpenseContacts ? (
        <section className="organization-detail__section organization-people__contacts" aria-labelledby="organization-contacts-heading">
          <div>
            <p className="technical-label">EXPENSE CONTACTS</p>
            <h2 id="organization-contacts-heading">Expense contacts</h2>
            <p className="organization-detail__supporting-copy">People available when recording Organization expenses.</p>
          </div>
          {canManageExpenseContacts && expenseFriendCandidates.length ? (
            <ul className="organization-members__list organization-members__personal-friends">
              {expenseFriendCandidates.map((friend) => (
                <li className="organization-members__row" key={friend.personalFriendId}>
                  {friendIdentity(friend)}
                  <form action={addPersonalFriendAsOrganizationExpenseContactAction.bind(null, organizationId, friend.personalFriendId)}>
                    <button className="text-link" type="submit">Use in expenses</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
          {canManageExpenseContacts ? <Link className="action-link action-link--quiet" href={`/app/organizations/${organizationId}/friends?create=1`}>Manage expense contacts</Link> : null}
        </section>
      ) : null}
    </>
  );
}
