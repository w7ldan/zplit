import Link from "next/link";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { listGroupOverviewSummaries, listGroups } from "@/server/groups";
import { GroupCard } from "@/components/groups/group-card";
import { GroupForm } from "@/components/groups/group-form";
import { TaskPanel } from "@/components/app/task-panel";
import { zplitVNextFont } from "@/app/fonts";
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
  const groups = showArchived
    ? await listGroups(getDatabase(), session.user.id, undefined, "archived")
    : await listGroupOverviewSummaries(getDatabase(), session.user.id, null);
  const openCreate = (Array.isArray(params.create) ? params.create[0] : params.create) === "1";
  return (
    <section className={`app-page page-content zplit-vnext groups-vnext groups-page ${zplitVNextFont.variable}`} id="top">
      <div className="editorial-shell app-page__layout groups-vnext__layout">
        <header className="app-page__header">
          <div>
            <Link className="groups-vnext__parent-link vnext-link" href="/app/personal">Personal</Link>
            <p className="technical-label groups-vnext__eyebrow">PEER-TO-PEER SPACES</p>
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
          <div className="groups-vnext__view-toggle">
            {showArchived ? (
              <Link className="text-link" href="/app/personal/groups">
                Active groups
              </Link>
            ) : (
              <Link className="text-link" href="/app/personal/groups?filter=archived">
                Archived groups
              </Link>
            )}
          </div>
          {groups.length ? (
            <div className="group-grid groups-vnext__group-list" aria-label={showArchived ? "Archived groups" : "Your groups"}>
              {groups.map((group) => (
                <GroupCard
                  group={group}
                  balance={"youOwe" in group && "owedToYou" in group ? { youOwe: Number(group.youOwe), owedToYou: Number(group.owedToYou) } : undefined}
                  vnext
                  key={group.id}
                />
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
          eyebrow="NEW GROUP"
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
