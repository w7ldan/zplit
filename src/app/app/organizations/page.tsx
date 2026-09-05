import Link from "next/link";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/auth/require-session";
import { listOrganizations } from "@/server/organizations";
import { OrganizationForm } from "@/components/organizations/organization-form";
import { OrganizationCard } from "@/components/organizations/organization-card";
import { TaskPanel } from "@/components/app/task-panel";
import { createOrganizationAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizations" };

type OrganizationsPageProps = {
  searchParams?: Promise<{ create?: string | string[]; filter?: string | string[] }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrganizationsPage({
  searchParams = Promise.resolve({}),
}: OrganizationsPageProps = {}) {
  const session = await requireSession();
  const params = await searchParams;
  const showArchived = first(params.filter) === "archived";
  const organizations = await listOrganizations(getDatabase(), session.user.id, showArchived ? "archived" : "active");
  const openCreate = first(params.create) === "1";
  return (
    <section className="app-page organizations-page" id="top">
      <div className="editorial-shell app-page__layout">
        <div className="app-page__header">
          <div>
            <p className="technical-label">Organizations · managed spaces</p>
            <h1>Organizations</h1>
            <p className="organization-page__lede">
              Keep managed financial entities separate from your Personal ledger.
            </p>
          </div>
          <Link
            className="action-link action-link--primary"
            href="/app/organizations?create=1"
            data-task-trigger="organization-create"
          >
            New organization
          </Link>
        </div>
        <div className="ledger-section organization-section">
          <div className="ledger-section__heading">
            <h2 id="organization-grid-heading">{showArchived ? "Archived organizations" : "Your organizations"}</h2>
            <span className="technical-label">
              {organizations.length} {organizations.length === 1 ? "organization" : "organizations"}
            </span>
          </div>
          <div>
            {showArchived ? (
              <Link className="text-link" href="/app/organizations">
                View active organizations <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <Link className="text-link" href="/app/organizations?filter=archived">
                View archived organizations <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
          {organizations.length > 0 ? (
            <div className="organization-grid">
              {organizations.map((organization) => (
                <OrganizationCard
                  organization={organization}
                  key={organization.id}
                />
              ))}
            </div>
          ) : showArchived ? (
            <div className="ledger-empty organization-empty">
              <h2>No archived organizations.</h2>
              <p>
                Organizations with financial history appear here when archived.
              </p>
            </div>
          ) : (
            <div className="ledger-empty organization-empty">
              <h2>No organizations yet.</h2>
              <p>
                Create a managed space when you need a shared entity separate from Personal.
              </p>
              <Link
                className="text-link"
                href="/app/organizations?create=1"
                data-task-trigger="organization-create"
              >
                New organization <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </div>
      </div>
      {openCreate ? (
        <TaskPanel
          open
          title="New organization"
          description="Create a compact managed space. Its creator becomes the Owner."
          triggerId="organization-create"
        >
          <OrganizationForm action={createOrganizationAction} />
        </TaskPanel>
      ) : null}
    </section>
  );
}
