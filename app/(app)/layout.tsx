import { AppShell } from "@/app/components/app-shell";
import { requirePageContext } from "@/lib/ats/authz";

export const dynamic = "force-dynamic";

export default async function HiringLayout({ children }: { children: React.ReactNode }) {
  const context = await requirePageContext();
  return <AppShell organization={context.organization} user={context.user} role={context.role}>{children}</AppShell>;
}
