"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { SearchableCombobox, type SearchableOption } from "@/components/records/searchable-combobox";
import { UserAvatar } from "@/components/identity/user-avatar";
import type { OrganizationInvitationRole } from "@/domain/organization-permissions";
import type { OrganizationInvitationActionState, OrganizationInvitationSummary, OrganizationMember } from "@/domain/organization-contracts";
import type { PersonalFriendCandidate } from "@/domain/collaboration-candidates";
import {
  addPersonalFriendAsOrganizationExpenseContactAction,
  createOrganizationInvitationAction,
  invitePersonalFriendToOrganizationAction,
  searchOrganizationInvitationOptions,
  revokeOrganizationInvitationAction,
} from "@/app/app/organizations/actions";

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
  expenseFriendCandidates = [],
  canViewExpenseContacts = false,
  canManageExpenseContacts = false,
}: {
  organizationId: string;
  members?: OrganizationMember[];
  pendingInvitations: OrganizationInvitationSummary[];
  invitationRoles: OrganizationInvitationRole[];
  friendCandidates?: PersonalFriendCandidate[];
  expenseFriendCandidates?: PersonalFriendCandidate[];
  canViewExpenseContacts?: boolean;
  canManageExpenseContacts?: boolean;
}) {
  const [state, formAction] = useActionState(createOrganizationInvitationAction.bind(null, organizationId), initialState);
  const search = searchOrganizationInvitationOptions.bind(null, organizationId) as (query: string, selectedId?: string) => Promise<SearchableOption[]>;
  const canInvite = invitationRoles.length > 0;
  const registeredFriends = friendCandidates.filter(
    (friend) => friend.kind === "registered" && friend.userId && friend.username,
  );

  const friendIdentity = (candidate: PersonalFriendCandidate) => {
    const registered = candidate.kind === "registered" && candidate.userId && candidate.username;
    const identity = (
      <span className="organization-members__identity">
        <strong>{candidate.displayName}</strong>
        {registered ? <span>@{candidate.username}</span> : <span>{candidate.label ?? "Local contact"}</span>}
        <span>{registered ? "Registered" : "Local"}</span>
      </span>
    );
    return (
      <span className="organization-members__friend-identity">
        {registered ? (
          <UserAvatar
            userId={candidate.userId!}
            size="sm"
            decorative
          />
        ) : null}
        {identity}
      </span>
    );
  };

  return (
    <>
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
      <h2 id="organization-invite-heading">Invite a member</h2>
      <p className="technical-label">FROM PERSONAL FRIENDS</p>
      {registeredFriends.length ? (
        <ul className="organization-members__list organization-members__personal-friends">
          {registeredFriends.map((friend) => (
            <li className="organization-members__row" key={friend.personalFriendId}>
              {friendIdentity(friend)}
              <form
                className="organization-members__friend-invite"
                action={invitePersonalFriendToOrganizationAction.bind(null, organizationId, friend.userId!)}
              >
                <select
                  name="role"
                  defaultValue="member"
                  aria-label={`Role for ${friend.displayName}`}
                >
                  {invitationRoles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
                <button className="text-link" type="submit">
                  Invite
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="organization-detail__supporting-copy">
          No Personal friends available here. Search by @username below.
        </p>
      )}
      <p className="technical-label">OTHER ZPLIT USERS</p>
      <form
        className="organization-invite__form"
        action={formAction}
      >
        <label id="organization-invite-target-label" htmlFor="organization-invite-target">
          Search by @username
        </label>
        <SearchableCombobox
          id="organization-invite-target"
          name="targetUserId"
          value={state.values.targetUserId}
          options={[]}
          search={search}
          required
          placeholder="Search @username"
          searchLabel="Search @username"
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
          {state.error || "Search by username to find another Zplit user."}
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
    {canViewExpenseContacts ? (
      <section
        className="organization-detail__section organization-people__contacts"
        aria-labelledby="organization-contacts-heading"
      >
        <div>
          <p className="technical-label">EXPENSE CONTACTS</p>
          <h2 id="organization-contacts-heading">Expense contacts</h2>
          <p className="organization-detail__supporting-copy">
            People available when recording Organization expenses.{" "}
            Add someone from your Personal friends or create a local contact.
          </p>
        </div>
        {canManageExpenseContacts ? (
          expenseFriendCandidates.length ? (
            <ul className="organization-members__list organization-members__personal-friends">
              {expenseFriendCandidates.map((friend) => (
                <li className="organization-members__row" key={friend.personalFriendId}>
                  {friendIdentity(friend)}
                  <form
                    action={addPersonalFriendAsOrganizationExpenseContactAction.bind(
                      null,
                      organizationId,
                      friend.personalFriendId,
                    )}
                  >
                    <button className="text-link" type="submit">
                      Use in expenses
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="organization-detail__supporting-copy">
              No Personal friends available here. Add someone else below.
            </p>
          )
        ) : null}
        {canManageExpenseContacts ? (
          <Link
            className="action-link action-link--quiet"
            href={`/app/organizations/${organizationId}/friends?create=1`}
          >
            Add someone else
          </Link>
        ) : null}
      </section>
    ) : null}
    </>
  );
}
