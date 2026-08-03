import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth/runtime";
import { SignOutButton } from "@/components/auth/sign-out-button";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <main className="protected-page" id="top">
      <div className="protected-page__field" aria-hidden="true" />
      <div className="editorial-grid editorial-shell protected-page__layout">
        <div className="protected-page__marker technical-label">06 / LEDGER ACCESS</div>
        <div className="protected-page__content">
          <p className="technical-label protected-page__metadata">PRIVATE APPLICATION / OWNER SESSION</p>
          <h1>Ledger access established.</h1>
          <div className="protected-page__identity" aria-label="Signed-in owner">
            <div>
              <span className="technical-label">Owner name</span>
              <strong>{session.user.name}</strong>
            </div>
            <div>
              <span className="technical-label">Owner email</span>
              <strong>{session.user.email}</strong>
            </div>
          </div>
          <p className="protected-page__lede">
            Friends, expenses, and repayments arrive in the next product stages. This access point is ready for the record.
          </p>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
