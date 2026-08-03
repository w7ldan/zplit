import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth/runtime";
import { LoginForm } from "@/components/auth/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) redirect("/app");

  return (
    <main className="access-page" id="top">
      <div className="access-page__field" aria-hidden="true" />
      <div className="editorial-grid editorial-shell access-page__layout">
        <div className="access-page__marker technical-label">05 / ACCESS</div>
        <div className="access-page__content">
          <p className="technical-label access-page__metadata">PRIVATE RECORD / SINGLE OWNER</p>
          <h1>Private ledger.</h1>
          <p className="access-page__lede">
            Zplit is a single-owner record for one operator. Enter the ledger to continue to the private application.
          </p>
          <LoginForm />
          <Link className="action-link action-link--quiet access-page__back" href="/">
            Back to the public record
          </Link>
        </div>
      </div>
    </main>
  );
}
