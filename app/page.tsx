import { Building2, ShieldAlert } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/components/login-form";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const requestHeaders = await headers();
  const user = await getSessionUserFromCookieHeader(requestHeaders.get("cookie"));
  if (user) redirect("/dashboard");
  const counts = await query<{ candidates: number; jobs: number }>(
    `select (select count(*)::int from candidates) as candidates,
      (select count(*)::int from jobs where state='open') as jobs`
  ).catch(() => ({ rows: [{ candidates: 0, jobs: 0 }] }));
  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand"><span className="brand-mark large">C</span><span><strong>Complyance</strong><small>Hiring</small></span></div>
        <div className="login-statement"><p className="eyebrow">Hiring operations</p><h1>Every hiring decision, in one accountable record.</h1></div>
        <div className="login-stats"><div><strong>{counts.rows[0]?.jobs ?? 0}</strong><span>Open jobs</span></div><div><strong>{counts.rows[0]?.candidates ?? 0}</strong><span>Candidates</span></div></div>
      </section>
      <section className="login-access-panel">
        <div className="login-box">
          <div className="login-icon"><Building2 size={22} /></div>
          <p className="eyebrow">Team access</p>
          <h2>Sign in to hiring</h2>
          <p className="muted-copy">Use an active team email.</p>
          <LoginForm />
          <div className="security-note"><ShieldAlert size={17} /><span>Internal beta · email allowlist access</span></div>
        </div>
      </section>
    </main>
  );
}
