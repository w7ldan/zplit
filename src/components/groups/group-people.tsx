"use client";

import { useActionState, useState } from "react";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import type { GroupJoinRequestActionState, GroupJoinRequestSummary, GroupParticipant } from "@/domain/group-contracts";
import type { PersonalFriendCandidate } from "@/domain/collaboration-candidates";
import { SearchableCombobox, type SearchableOptionAction } from "@/components/records/searchable-combobox";
import { UserAvatar } from "@/components/identity/user-avatar";
import {
  addPersonalFriendAsGroupParticipantAction,
  createExternalParticipantAction,
  createGroupInvitationAction,
  createGroupParticipantLinkRequestAction,
  deleteExternalParticipantAction,
  removeGroupMemberAction,
  revokeGroupJoinRequestAction,
  searchGroupJoinUserOptions,
  invitePersonalFriendToGroupAction,
  updateExternalParticipantAction,
  updateGroupMemberRoleAction,
} from "@/app/app/personal/groups/actions";

function roleLabel(role: string | null) {
  return role ? role[0]?.toUpperCase() + role.slice(1) : "";
}

function requestStatusLabel(status: string) {
  return status[0]?.toUpperCase() + status.slice(1);
}

const initialJoinState: GroupJoinRequestActionState = { error: "", values: { targetUserId: "" } };

function GroupJoinForm({
  id,
  search,
  action,
  buttonLabel,
  description,
  onCancel,
}: {
  id: string;
  search: SearchableOptionAction;
  action: (
    state: GroupJoinRequestActionState,
    formData: FormData,
  ) => Promise<GroupJoinRequestActionState>;
  buttonLabel: string;
  description?: string;
  onCancel?: () => void;
}) {
  const [state, formAction] = useActionState(action, initialJoinState);
  return (
    <form className="group-join-form" action={formAction}>
      {description ? (
        <p className="group-detail__supporting-copy">{description}</p>
      ) : null}
      <label id={`${id}-label`} htmlFor={id}>
        Search by @username
      </label>
      <SearchableCombobox
        id={id}
        name="targetUserId"
        value={state.values.targetUserId}
        options={[]}
        search={search}
        required
        placeholder="Search @username"
        searchLabel="Search @username"
        labelId={`${id}-label`}
      />
      <p
        className="group-join-form__message"
        role={state.error && !state.error.endsWith("sent.") ? "alert" : "status"}
      >
        {state.error || "Search by username to find another Zplit user."}
      </p>
      <div className="group-join-form__actions">
        {onCancel ? (
          <button
            className="text-link"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
        <button
          className="action-link action-link--quiet"
          type="submit"
        >
          {buttonLabel}
        </button>
      </div>
    </form>
  );
}

function PersonalFriendIdentity({ candidate }: { candidate: PersonalFriendCandidate }) {
  if (candidate.kind === "registered" && candidate.userId && candidate.username) {
    return (
      <span className="group-people__personal-friend-identity">
        <UserAvatar
          userId={candidate.userId}
          size="sm"
          decorative
        />
        <span className="group-people__identity">
          <strong>{candidate.displayName}</strong>
          <span>@{candidate.username}</span>
          <span>Registered</span>
        </span>
      </span>
    );
  }
  return (
    <span className="group-people__personal-friend-identity">
      <span className="group-people__identity">
        <strong>{candidate.displayName}</strong>
        <span>{candidate.label ?? "Local contact"}</span>
        <span>Local</span>
      </span>
    </span>
  );
}

function PersonalFriendAction({ groupId, candidate }: { groupId: string; candidate: PersonalFriendCandidate }) {
  if (candidate.kind === "registered" && candidate.userId && candidate.username) {
    return (
      <form action={invitePersonalFriendToGroupAction.bind(null, groupId, candidate.userId)}>
        <button className="text-link" type="submit">
          Invite
        </button>
      </form>
    );
  }
  return (
    <form action={addPersonalFriendAsGroupParticipantAction.bind(null, groupId, candidate.personalFriendId)}>
      <button className="text-link" type="submit">
        Add
      </button>
    </form>
  );
}

function GroupParticipantLinkControl({
  groupId,
  participant,
  pending,
  search,
}: {
  groupId: string;
  participant: GroupParticipant;
  pending?: GroupJoinRequestSummary;
  search: SearchableOptionAction;
}) {
  const [open, setOpen] = useState(false);
  if (pending) return (
    <div className="group-people__link-state">
      <span>Pending link → @{pending.targetUsername}</span>
      <form
        action={revokeGroupJoinRequestAction.bind(null, groupId, pending.id)}
      >
        <button className="text-link" type="submit">
          Revoke
        </button>
      </form>
    </div>
  );
  if (!open) return (
    <button
      className="text-link"
      type="button"
      onClick={() => setOpen(true)}
    >
      Link Zplit account
    </button>
  );
  return (
    <GroupJoinForm
      id={`group-link-${participant.id}`}
      search={search}
      action={createGroupParticipantLinkRequestAction.bind(
        null,
        groupId,
        participant.id,
      )}
      buttonLabel="Send link request"
      description={
        `Link this existing participant${participant.label ? ` · ${participant.label}` : ""} to a Zplit account.`
      }
      onCancel={() => setOpen(false)}
    />
  );
}

export function GroupPeople({
  groupId,
  participants,
  pendingInvitations = [],
  pendingLinks = [],
  friendCandidates = [],
  canManageParticipants,
  canManageRoles,
}: {
  groupId: string;
  participants: GroupParticipant[];
  pendingInvitations?: GroupJoinRequestSummary[];
  pendingLinks?: GroupJoinRequestSummary[];
  friendCandidates?: PersonalFriendCandidate[];
  canManageParticipants: boolean;
  canManageRoles: boolean;
}) {
  const members = participants.filter((participant) => !participant.isExternal && !participant.isFormer);
  const former = participants.filter((participant) => participant.isFormer);
  const external = participants.filter((participant) => participant.isExternal);
  const pendingLinkByParticipant = new Map(pendingLinks.map((request) => [request.participantId, request]));
  const search = searchGroupJoinUserOptions.bind(null, groupId) as SearchableOptionAction;
  return (
    <>
      <section
        className="group-detail__section"
        aria-labelledby="group-members-heading"
      >
        <div className="group-section-heading">
          <div>
            <p className="technical-label">REGISTERED</p>
            <h2 id="group-members-heading">Members</h2>
          </div>
          <span className="technical-label">{members.length}</span>
        </div>
        <ul className="group-people__list">
          {members.map((member) => (
            <li className="group-people__row" key={member.id}>
              <span className="group-people__identity">
                <strong>{member.displayName}</strong>
                <span>{roleLabel(member.role)}</span>
              </span>
              {member.role !== "owner" && canManageRoles ? (
                <form
                  action={updateGroupMemberRoleAction.bind(
                    null,
                    groupId,
                    member.userId ?? "",
                  )}
                >
                  <select
                    name="role"
                    defaultValue={member.role ?? "member"}
                    aria-label={`Role for ${member.displayName}`}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="text-link" type="submit">
                    Save role
                  </button>
                </form>
              ) : null}
              {member.role !== "owner" &&
              (canManageRoles ||
                (canManageParticipants && member.role === "member")) ? (
                <form
                  action={removeGroupMemberAction.bind(
                    null,
                    groupId,
                    member.userId ?? "",
                  )}
                >
                  <button className="text-link" type="submit">
                    Remove
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {former.length ? (
          <div className="group-people__pending">
            <h3>Former participants</h3>
            <ul className="group-people__list">
              {former.map((participant) => (
                <li className="group-people__row" key={participant.id}>
                  <span className="group-people__identity">
                    <strong>{participant.displayName}</strong>
                    <span>Former participant</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {canManageParticipants ? (
          <div className="group-people__invite">
            <h3>Invite a member</h3>
            <p className="technical-label">FROM PERSONAL FRIENDS</p>
            {friendCandidates.length ? (
              <ul className="group-people__list group-people__personal-friends">
                {friendCandidates.map((candidate) => (
                  <li className="group-people__row" key={candidate.personalFriendId}>
                    <PersonalFriendIdentity candidate={candidate} />
                    <PersonalFriendAction groupId={groupId} candidate={candidate} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="group-detail__empty">
                No Personal friends available here. Search by @username or add another person below.
              </p>
            )}
            <p className="technical-label">OTHER ZPLIT USERS</p>
            <GroupJoinForm
              id="group-invite-target"
              search={search}
              action={createGroupInvitationAction.bind(null, groupId)}
              buttonLabel="Send invitation"
            />
          </div>
        ) : null}
        {canManageParticipants && pendingInvitations.length > 0 ? (
          <div className="group-people__pending">
            <h3>Pending invitations</h3>
            <ul className="group-people__list">
              {pendingInvitations.map((invitation) => (
                <li className="group-people__row" key={invitation.id}>
                  <span className="group-people__identity">
                    <strong>{invitation.targetDisplayName}</strong>
                    <span>@{invitation.targetUsername}</span>
                  </span>
                  <span className="group-people__request-meta">
                    {requestStatusLabel(invitation.status)} · Expires <LocalDateTime
                      iso={invitation.expiresAt}
                      mode="date"
                    />
                  </span>
                  <form
                    action={revokeGroupJoinRequestAction.bind(
                      null,
                      groupId,
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
      </section>
      <section
        className="group-detail__section"
        aria-labelledby="group-external-heading"
      >
        <div className="group-section-heading">
          <div>
            <p className="technical-label">LOCAL CONTEXT</p>
            <h2 id="group-external-heading">External participants</h2>
          </div>
          <span className="technical-label">{external.length}</span>
        </div>
        {external.length ? (
          <ul className="group-people__list">
            {external.map((participant) => (
              <li
                className="group-people__row group-people__row--external"
                key={participant.id}
              >
                <div className="group-people__external-main">
                  {canManageParticipants ? (
                    <form
                      className="group-external-form"
                      action={updateExternalParticipantAction.bind(
                        null,
                        groupId,
                        participant.id,
                      )}
                    >
                      <div>
                        <input
                          name="displayName"
                          aria-label={`Name for ${participant.displayName}`}
                          defaultValue={participant.displayName}
                        />
                        <input
                          name="label"
                          aria-label={`Label for ${participant.displayName}`}
                          defaultValue={participant.label ?? ""}
                          placeholder="Label (optional)"
                        />
                      </div>
                      <button className="text-link" type="submit">
                        Save
                      </button>
                      <button
                        className="text-link"
                        type="submit"
                        formAction={deleteExternalParticipantAction.bind(
                          null,
                          groupId,
                          participant.id,
                        )}
                      >
                        Remove
                      </button>
                    </form>
                  ) : (
                    <span className="group-people__identity">
                      <strong>{participant.displayName}</strong>
                      {participant.label ? (
                        <span>{participant.label}</span>
                      ) : null}
                    </span>
                  )}
                  <span className="group-people__external-meta">External</span>
                </div>
                {canManageParticipants ? (
                  <GroupParticipantLinkControl
                    groupId={groupId}
                    participant={participant}
                    pending={pendingLinkByParticipant.get(participant.id)}
                    search={search}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="group-detail__empty">No external participants yet.</p>
        )}
        {canManageParticipants ? (
          <form
            className="group-external-create"
            action={createExternalParticipantAction.bind(null, groupId)}
          >
            <input
              name="displayName"
              placeholder="Name"
              aria-label="External participant name"
              required
            />
            <input
              name="label"
              placeholder="Label (optional)"
              aria-label="External participant label"
            />
            <button
              className="action-link action-link--quiet"
              type="submit"
            >
              Add external participant
            </button>
          </form>
        ) : null}
      </section>
    </>
  );
}
