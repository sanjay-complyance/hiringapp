"use client";

import {
  BarChart3, BriefcaseBusiness, CalendarDays, CheckSquare2, LayoutDashboard, LogOut, Menu,
  Settings, UserRoundSearch, X
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { initials, titleCase } from "@/lib/ats/format";
import { SyncWatcher } from "@/app/components/sync-watcher";
import { hasPermission } from "@/lib/ats/permissions";
import type { MembershipRole, Permission } from "@/lib/ats/types";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/candidates", label: "Candidates", icon: UserRoundSearch },
  { href: "/interviews", label: "Interviews", icon: CalendarDays },
  { href: "/tasks", label: "Tasks", icon: CheckSquare2, permission: "tasks:manage" as Permission },
  { href: "/reports", label: "Reports", icon: BarChart3, permission: "reports:read" as Permission },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({
  children,
  organization,
  user,
  role
}: {
  children: React.ReactNode;
  organization: { name: string };
  user: { name: string; email: string };
  role: MembershipRole;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="app-frame">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">C</span>
          <span><strong>{organization.name}</strong><small>Hiring</small></span>
          <button className="icon-button sidebar-close" onClick={() => setOpen(false)} aria-label="Close navigation" title="Close navigation"><X size={18} /></button>
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.filter((item) => !item.permission || hasPermission(role, item.permission)).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setOpen(false)}>
                <Icon size={18} strokeWidth={1.9} /><span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar">{initials(user.name)}</div>
          <div className="sidebar-user"><strong>{user.name}</strong><span>{titleCase(role)}</span></div>
          <button className="icon-button" onClick={logout} aria-label="Log out" title="Log out"><LogOut size={17} /></button>
        </div>
      </aside>
      {open ? <button className="nav-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
      <div className="app-body">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setOpen(true)} aria-label="Open navigation" title="Open navigation"><Menu size={19} /></button>
          <div className="topbar-context"><strong>{organization.name} Hiring</strong><span>Internal beta</span></div>
          <SyncWatcher />
          <div className="topbar-user"><span>{user.email}</span><div className="user-avatar small">{initials(user.name)}</div></div>
        </header>
        <main className="page-container">{children}</main>
      </div>
    </div>
  );
}
