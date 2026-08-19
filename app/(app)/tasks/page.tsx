import { CheckSquare2, Clock3 } from "lucide-react";
import Link from "next/link";
import { TaskForm } from "@/app/components/candidate-actions";
import { TaskToggle } from "@/app/components/operational-actions";
import { PageHeader } from "@/app/components/page-header";
import { requirePageContext } from "@/lib/ats/authz";
import { getSettingsData, getTasks } from "@/lib/ats/data";
import { formatDateTime, titleCase } from "@/lib/ats/format";

export default async function TasksPage() {
  const context = await requirePageContext("tasks:manage");
  const [tasks, settings] = await Promise.all([getTasks(context.organization.id), getSettingsData(context.organization.id)]);
  const open = tasks.filter((task) => task.status === "open");
  const overdue = open.filter((task) => task.due_at && new Date(task.due_at) < new Date());
  return <><PageHeader eyebrow="Action inbox" title="Tasks" description={`${open.length} open · ${overdue.length} overdue`} actions={<TaskForm members={settings.members} />} /><section className="task-board"><div className="task-group"><div className="task-group-head"><span><Clock3 size={16} />Open</span><strong>{open.length}</strong></div>{open.map((task) => <article className={`task-card ${task.due_at && new Date(task.due_at) < new Date() ? "overdue" : ""}`} key={task.id}><TaskToggle id={task.id} version={task.version} status={task.status} /><div><strong>{task.title}</strong><p>{task.description || "No additional details"}</p><div className="meta-row"><span>{task.assigned_name || "Unassigned"}</span><span className={`badge priority-${task.priority}`}>{titleCase(task.priority)}</span><time>Due {formatDateTime(task.due_at)}</time>{task.reminder_at ? <time>Reminder {formatDateTime(task.reminder_at)}</time> : null}{task.candidate_id ? <Link href={`/candidates/${task.candidate_id}`}>{task.candidate_name}</Link> : task.job_id ? <Link href={`/jobs/${task.job_id}`}>{task.job_title}</Link> : null}</div></div></article>)}</div><div className="task-group completed-group"><div className="task-group-head"><span><CheckSquare2 size={16} />Completed</span><strong>{tasks.filter((task) => task.status === "completed").length}</strong></div>{tasks.filter((task) => task.status === "completed").slice(0, 20).map((task) => <article className="task-card complete" key={task.id}><TaskToggle id={task.id} version={task.version} status={task.status} /><div><strong>{task.title}</strong><div className="meta-row"><span>{task.assigned_name || "Unassigned"}</span><span>{task.candidate_name || task.job_title || "General"}</span></div></div></article>)}</div></section></>;
}
