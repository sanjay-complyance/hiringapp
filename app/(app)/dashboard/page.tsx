import { AlertTriangle, ArrowRight, BriefcaseBusiness, CalendarDays, CheckSquare2, Clock3, UsersRound } from "lucide-react";
import Link from "next/link";
import { TaskForm } from "@/app/components/candidate-actions";
import { PageHeader } from "@/app/components/page-header";
import { TaskToggle } from "@/app/components/operational-actions";
import { hasPermission, requirePageContext } from "@/lib/ats/authz";
import { getDashboardData, getSettingsData } from "@/lib/ats/data";
import { formatDate, formatDateTime, relativeAge, titleCase } from "@/lib/ats/format";

export default async function DashboardPage() {
  const context = await requirePageContext("candidates:read");
  const [data, settings] = await Promise.all([getDashboardData(context.organization.id, context.user.id), getSettingsData(context.organization.id)]);
  const canManageTasks = hasPermission(context.role, "tasks:manage");
  const stats = [
    { label: "Open jobs", value: data.summary.open_jobs, icon: BriefcaseBusiness, tone: "blue" },
    { label: "Active candidates", value: data.summary.active_applications, icon: UsersRound, tone: "green" },
    { label: "Overdue actions", value: data.summary.overdue_tasks, icon: Clock3, tone: data.summary.overdue_tasks ? "red" : "neutral" },
    { label: "Upcoming interviews", value: data.summary.upcoming_interviews, icon: CalendarDays, tone: "amber" },
    { label: "Pending approvals", value: data.summary.pending_approvals, icon: CheckSquare2, tone: "purple" }
  ];
  return <>
    <PageHeader eyebrow="Hiring command center" title="Dashboard" description={`Good to see you, ${context.user.name.split(" ")[0]}.`} actions={canManageTasks ? <TaskForm members={settings.members} /> : null} />
    <section className="metric-grid">{stats.map((stat) => { const Icon = stat.icon; return <article className={`metric-card ${stat.tone}`} key={stat.label}><div><span>{stat.label}</span><strong>{stat.value}</strong></div><Icon size={20} /></article>; })}</section>
    <div className="dashboard-grid">
      <section className="content-section span-wide">
        <div className="section-heading"><div><p className="eyebrow">Portfolio</p><h2>Hiring plans</h2></div><Link className="text-link" href="/jobs">All jobs <ArrowRight size={15} /></Link></div>
        <div className="job-dashboard-list">{data.jobs.map((job) => <Link href={`/jobs/${job.id}`} className="job-dashboard-row" key={job.id}><div className="job-title-cell"><strong>{job.title}</strong><span>{job.department} · {job.hiring_manager_name || "Manager unassigned"}</span></div><span className={`badge ${job.state}`}>{titleCase(job.state)}</span><div className="mini-metric"><strong>{job.active}</strong><span>Active</span></div><div className="mini-metric"><strong>{job.total}</strong><span>Total</span></div><div className="mini-metric warning"><strong>{job.overdue}</strong><span>Overdue</span></div><ArrowRight size={16} /></Link>)}</div>
      </section>
      <section className="content-section">
        <div className="section-heading"><div><p className="eyebrow">My work</p><h2>Action inbox</h2></div><Link className="text-link" href="/tasks">All tasks</Link></div>
        <div className="task-list">{data.tasks.map((task) => <div className="task-row" key={task.id}>{canManageTasks ? <TaskToggle id={task.id} version={task.version} status={task.status} /> : null}<div><strong>{task.title}</strong><span>{task.candidate_name || task.job_title || "General"}</span></div><time className={task.due_at && new Date(task.due_at) < new Date() ? "overdue-text" : ""}>{formatDate(task.due_at)}</time></div>)}{!data.tasks.length ? <div className="empty-inline"><CheckSquare2 size={18} />No open tasks</div> : null}</div>
      </section>
      <section className="content-section">
        <div className="section-heading"><div><p className="eyebrow">Schedule</p><h2>Upcoming interviews</h2></div><Link className="text-link" href="/interviews">Calendar</Link></div>
        <div className="schedule-list">{data.interviews.map((interview) => <Link href={`/candidates/${interview.candidate_id}`} className="schedule-row" key={interview.id}><div className="date-tile"><strong>{new Date(interview.starts_at || "").getDate()}</strong><span>{new Date(interview.starts_at || "").toLocaleString("en-IN", { month: "short" })}</span></div><div><strong>{interview.candidate_name}</strong><span>{interview.title} · {formatDateTime(interview.starts_at)}</span></div></Link>)}{!data.interviews.length ? <div className="empty-inline"><CalendarDays size={18} />No upcoming interviews</div> : null}</div>
      </section>
      <section className="content-section activity-section">
        <div className="section-heading"><div><p className="eyebrow">Audit</p><h2>Recent activity</h2></div></div>
        <div className="activity-list">{data.activity.slice(0, 8).map((event) => <div className="activity-row" key={event.id}><span className="activity-icon">{event.event_type.includes("rejected") || event.event_type.includes("failed") ? <AlertTriangle size={14} /> : <CheckSquare2 size={14} />}</span><div><strong>{titleCase(event.event_type.replaceAll(".", " "))}</strong><span>{event.actor_name || "System"} · {relativeAge(event.created_at)}</span></div></div>)}</div>
      </section>
    </div>
  </>;
}
