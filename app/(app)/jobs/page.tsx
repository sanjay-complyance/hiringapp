import { ArrowRight, BriefcaseBusiness, MapPin, Target } from "lucide-react";
import Link from "next/link";
import { CreateJobForm } from "@/app/components/job-actions";
import { PageHeader } from "@/app/components/page-header";
import { hasPermission, requirePageContext } from "@/lib/ats/authz";
import { getJobs, getSettingsData } from "@/lib/ats/data";
import { formatDate, titleCase } from "@/lib/ats/format";

export default async function JobsPage() {
  const context = await requirePageContext("candidates:read");
  const [jobs, settings] = await Promise.all([getJobs(context.organization.id), getSettingsData(context.organization.id)]);
  return <>
    <PageHeader eyebrow="Requisitions" title="Jobs" description={`${jobs.filter((job) => job.state === "open").length} open hiring plans`} actions={hasPermission(context.role, "jobs:create") ? <CreateJobForm members={settings.members} templates={settings.templates} /> : null} />
    <section className="job-list">{jobs.map((job) => <article className="job-list-row" key={job.id}><div className="job-icon"><BriefcaseBusiness size={20} /></div><div className="job-list-main"><div><Link href={`/jobs/${job.id}`}>{job.title}</Link><span className={`badge ${job.state}`}>{titleCase(job.state)}</span><span className={`badge priority-${job.priority}`}>{titleCase(job.priority)}</span></div><p>{job.business_reason}</p><div className="meta-row"><span><Target size={14} />{job.openings} opening{job.openings === 1 ? "" : "s"}</span><span><MapPin size={14} />{job.location || "Location not set"} · {titleCase(job.work_mode)}</span><span>Target {formatDate(job.target_date)}</span></div></div><div className="job-list-stats"><div><strong>{job.active}</strong><span>Active</span></div><div><strong>{job.total}</strong><span>Total</span></div><div><strong>{job.hired}</strong><span>Hired</span></div></div><Link className="icon-button" href={`/jobs/${job.id}`} aria-label={`Open ${job.title}`} title={`Open ${job.title}`}><ArrowRight size={17} /></Link></article>)}</section>
    {!jobs.length ? <div className="empty-state"><BriefcaseBusiness size={28} /><strong>No requisitions yet</strong></div> : null}
  </>;
}
