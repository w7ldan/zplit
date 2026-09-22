import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth/runtime";
import { JoinedConfirmation } from "@/components/auth/joined-confirmation";
import { LoginForm } from "@/components/auth/login-form";
import { AccessFrame } from "@/components/editorial/access-frame";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to open your private shared-expense ledger.",
  openGraph: {
    title: "Sign in to Zplit",
    description: "Sign in to open your private shared-expense ledger.",
    siteName: "Zplit",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sign in to Zplit",
    description: "Sign in to open your private shared-expense ledger.",
  },
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ joined?: string | string[]; [key: string]: string | string[] | undefined }> } = {}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) redirect("/app");
  const created = searchParams ? await searchParams : {};
  const joined = Array.isArray(created.joined) ? created.joined[0] === "1" : created.joined === "1";

  return (
    <AccessFrame variant="login" marker="ACCESS" eyebrow="RETURNING TO YOUR LEDGER">
      <h1>Welcome back.</h1>
      <p className="access-vnext__lede">Sign in to continue your shared-expense record and see what is open, repaid, or settled.</p>
      <JoinedConfirmation active={joined} />
      <LoginForm />
      <Link className="access-vnext__back" href="/">← Back to Zplit</Link>
    </AccessFrame>
  );
}
