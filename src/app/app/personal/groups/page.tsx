import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { listGroups } from "@/server/groups";
import { GroupCard } from "@/components/groups/group-card";
import { GroupForm } from "@/components/groups/group-form";
import { TaskPanel } from "@/components/app/task-panel";
import { createGroupAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Groups" };

export default async function GroupsPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ create?: string | string[]; filter?: string | string[] }>;
} = {}) {
  const session = await requireSession();
  const params = await searchParams;
  const showArchived = (Array.isArray(params.filter) ? params.filter[0] : params.filter) === "archived";
  const groups = await listGroups(getDatabase(), session.user.id, undefined, showArchived ? "archived" : "active");
  const openCreate = (Array.isArray(params.create) ? params.create[0] : params.create) === "1";
  return (
    <section className="app-page groups-page" id="top">
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Personal · peer-to-peer spaces</p>
            <h1>Groups</h1>
            <p className="app-page__lede">Shared-expense spaces where participants remain the people behind the accounting.</p>
          </div>
          <Link
            className="action-link action-link--primary"
            href="/app/personal/groups?create=1"
            data-task-trigger="group-create"
          >
            New group
          </Link>
        </header>
        <section className="ledger-section group-section">
          <div className="ledger-section__heading">
            <h2 id="group-grid-heading">{showArchived ? "Archived groups" : "Your groups"}</h2>
            <span className="technical-label">
              {groups.length} {groups.length === 1 ? "group" : "groups"}
            </span>
          </div>
          <div>
            {showArchived ? (
              <Link className="text-link" href="/app/personal/groups">
                View active groups <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <Link className="text-link" href="/app/personal/groups?filter=archived">
                View archived groups <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
          {groups.length ? (
            <div className="group-grid">
              {groups.map((group) => (
                <GroupCard group={group} key={group.id} />
              ))}
            </div>
          ) : showArchived ? (
            <div className="ledger-empty">
              <h2>No archived groups.</h2>
              <p>Groups with financial history appear here when archived.</p>
            </div>
          ) : (
            <div className="ledger-empty">
              <h2>No groups yet.</h2>
              <p>Create a peer-to-peer space for shared expenses.</p>
              <Link
                className="text-link"
                href="/app/personal/groups?create=1"
                data-task-trigger="group-create"
              >
                Create a group <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </section>
      </div>
      {openCreate ? (
        <TaskPanel
          open
          title="New group"
          description="Create a peer-to-peer shared-expense space. You become its Owner."
          triggerId="group-create"
        >
          <GroupForm action={createGroupAction} />
        </TaskPanel>
      ) : null}
    </section>
  );
}
