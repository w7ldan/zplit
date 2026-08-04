import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth/runtime";
import { JoinedConfirmation } from "@/components/auth/joined-confirmation";
import { LoginForm } from "@/components/auth/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ joined?: string | string[]; [key: string]: string | string[] | undefined }> } = {}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) redirect("/app");
  const created = searchParams ? await searchParams : {};
  const joined = Array.isArray(created.joined) ? created.joined[0] === "1" : created.joined === "1";

  return (
    <main className="access-page" id="top">
      <div className="access-page__field" aria-hidden="true" />
      <div className="editorial-grid editorial-shell access-page__layout">
        <div className="access-page__marker technical-label"><Link href="/">Zplit</Link><span>ACCESS</span></div>
        <div className="access-page__content">
          <p className="technical-label access-page__metadata">RETURNING TO YOUR LEDGER</p>
          <h1>Welcome back.</h1>
          <p className="access-page__lede">
            Sign in to continue your shared-expense record and see what is open, repaid, or settled.
          </p>
          <JoinedConfirmation active={joined} />
          <LoginForm />
          <Link className="access-page__back" href="/">← Back to Zplit</Link>
        </div>
      </div>
    </main>
  );
}
