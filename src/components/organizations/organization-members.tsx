"use client";

import { useActionState } from "react";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { SearchableCombobox, type SearchableOption } from "@/components/records/searchable-combobox";
import { UserAvatar } from "@/components/identity/user-avatar";
import type { OrganizationInvitationRole } from "@/domain/organization-permissions";
import type { OrganizationInvitationActionState, OrganizationInvitationSummary, OrganizationMember } from "@/domain/organization-contracts";
import type { RegisteredFriendCandidate } from "@/domain/collaboration-candidates";
import { createOrganizationInvitationAction, revokeOrganizationInvitationAction, searchOrganizationInvitationOptions } from "@/app/app/organizations/actions";

function roleLabel(role: string) {
  return role[0]?.toUpperCase() + role.slice(1);
}

const initialState: OrganizationInvitationActionState = { error: "", values: { targetUserId: "", role: "member" } };

export function OrganizationMembers({
  organizationId,
  members,
  pendingInvitations,
  invitationRoles,
  friendCandidates = [],
}: {
  organizationId: string;
  members?: OrganizationMember[];
  pendingInvitations: OrganizationInvitationSummary[];
  invitationRoles: OrganizationInvitationRole[];
  friendCandidates?: RegisteredFriendCandidate[];
}) {
  const [state, formAction] = useActionState(createOrganizationInvitationAction.bind(null, organizationId), initialState);
  const search = searchOrganizationInvitationOptions.bind(null, organizationId) as (query: string, selectedId?: string) => Promise<SearchableOption[]>;
  const friendOptions = friendCandidates.map((friend) => ({
    id: friend.userId,
    label: `${friend.displayName} · @${friend.username}`,
    group: "Friends",
  }));
  const canInvite = invitationRoles.length > 0;

  return <>
    {members ? <section className="organization-detail__section" aria-labelledby="organization-members-heading">
      <h2 id="organization-members-heading">Members</h2>
      <ul className="organization-members__list">
        {members.map((member) => (
          <li className="organization-members__row" key={member.id}>
            <UserAvatar
              userId={member.id}
              size="sm"
              alt={`${member.displayName} avatar`}
            />
            <span className="organization-members__identity">
              <strong>{member.displayName}</strong>
              {member.username ? <span>@{member.username}</span> : null}
            </span>
            <span className="organization-members__role">
              {roleLabel(member.role)}
            </span>
          </li>
        ))}
      </ul>
    </section> : null}
    {canInvite ? <section className="organization-detail__section" aria-labelledby="organization-invite-heading">
      <h2 id="organization-invite-heading">Invite member</h2>
      <form
        className="organization-invite__form"
        action={formAction}
      >
        <label id="organization-invite-target-label" htmlFor="organization-invite-target">
          Choose a friend or search by @username
        </label>
        <SearchableCombobox
          id="organization-invite-target"
          name="targetUserId"
          value={state.values.targetUserId}
          options={friendOptions}
          search={search}
          required
          placeholder="Choose a person"
          searchLabel="Search friends or @username"
          labelId="organization-invite-target-label"
        />
        <label htmlFor="organization-invite-role">Role</label>
        <select
          id="organization-invite-role"
          name="role"
          defaultValue={state.values.role}
        >
          {invitationRoles.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
        <p
          className="organization-invite__message"
          role={state.error && state.error !== "Invitation sent." ? "alert" : "status"}
        >
          {state.error || "Friends appear first; username search is the fallback."}
        </p>
        <button className="action-link action-link--primary" type="submit">
          Send invitation
        </button>
      </form>
      {pendingInvitations.length > 0 ? (
        <div className="organization-invite__pending">
          <h3>Pending invitations</h3>
          <ul className="organization-members__list">
            {pendingInvitations.map((invitation) => (
              <li className="organization-members__row" key={invitation.id}>
                <span className="organization-members__identity">
                  <strong>{invitation.displayName}</strong><span>@{invitation.username}</span>
                </span>
                <span className="organization-members__role">
                  {roleLabel(invitation.role)} · Expires <LocalDateTime iso={invitation.expiresAt} mode="date" />
                </span>
                <form
                  action={revokeOrganizationInvitationAction.bind(
                    null,
                    organizationId,
                    invitation.id,
                  )}
                >
                  <button className="text-link" type="submit">
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section> : null}
  </>;
}
