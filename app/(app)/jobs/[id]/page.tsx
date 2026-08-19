import { CalendarClock, CheckCircle2, CircleDollarSign, MapPin, Target } from "lucide-react";
import { notFound } from "next/navigation";
import { BatchCopilot } from "@/app/components/copilot";
import { EditJobForm, JobStateButton, PipelineBoard } from "@/app/components/job-actions";
import { PageHeader } from "@/app/components/page-header";
import { RubricForm, StageEditForm, StageForm } from "@/app/components/settings-actions";
import { hasPermission, requirePageContext } from "@/lib/ats/authz";
import { getJobDetail, getSettingsData } from "@/lib/ats/data";
import { formatDate, formatMoney, titleCase } from "@/lib/ats/format";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePageContext("candidates:read");
  const { id } = await params;
  const [data, settings] = await Promise.all([getJobDetail(context.organization.id, id, hasPermission(context.role, "offers:read")), getSettingsData(context.organization.id)]);
  if (!data.job) notFound();
  const job = data.job;
  const active = data.applications.filter((item) => item.state === "active").length;
  const canManageJob = hasPermission(context.role, "jobs:manage");
  const canManageApplications = hasPermission(context.role, "applications:manage");
  const rubricCriteria = (data.rubric?.criteria || []).map((criterion, index) => ({
    id: String(criterion.id || `criterion_${index + 1}`),
    label: String(criterion.label || criterion.id || `Criterion ${index + 1}`),
    max: Number(criterion.max || 0),
    hard: Boolean(criterion.hard)
  }));
  const actions = <>{canManageJob && ["draft", "open", "paused"].includes(job.state) ? <EditJobForm job={job} members={data.members} /> : null}{canManageJob && job.state === "draft" ? <JobStateButton jobId={job.id} version={job.version} action="submit" label="Submit for approval" /> : null}{job.state === "pending_approval" && hasPermission(context.role, "jobs:approve") ? <JobStateButton jobId={job.id} version={job.version} action="approve" label="Approve and open" /> : null}{canManageJob && job.state === "open" ? <JobStateButton jobId={job.id} version={job.version} action="pause" label="Pause" /> : null}{canManageJob && ["open", "paused"].includes(job.state) ? <JobStateButton jobId={job.id} version={job.version} action="close" label="Close" /> : null}{canManageJob && ["paused", "closed"].includes(job.state) ? <JobStateButton jobId={job.id} version={job.version} action="reopen" label="Reopen" /> : null}</>;
  return <>
    <PageHeader backHref="/jobs" backLabel="Jobs" eyebrow={`${job.department} · ${job.code || "No code"}`} title={job.title} description={job.business_reason} actions={actions} />
    <section className="job-summary-band"><div><span>Status</span><strong><i className={`status-dot ${job.state}`} />{titleCase(job.state)}</strong></div><div><span>Hiring manager</span><strong>{job.hiring_manager_name || "Unassigned"}</strong></div><div><span>Recruiter</span><strong>{job.recruiter_name || "Unassigned"}</strong></div><div><span>Target</span><strong>{formatDate(job.target_date)}</strong></div><div><span>Pipeline</span><strong>{active} active · {data.applications.length} total</strong></div></section>
    <div className="job-workspace-header"><div><p className="eyebrow">Candidate pipeline</p><h2>Applications</h2></div>{hasPermission(context.role, "ai:use") ? <BatchCopilot jobId={job.id} providers={settings.providers.map((item) => ({ provider: item.provider as "openai" | "anthropic" }))} applicationCount={active} /> : null}</div>
    <PipelineBoard applications={data.applications} stages={data.stages} canManage={canManageApplications} />
    <div className="detail-grid two-column">
      <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Requisition</p><h2>Hiring plan</h2></div></div><dl className="detail-list"><div><dt><Target size={15} />Openings</dt><dd>{job.openings}</dd></div><div><dt><MapPin size={15} />Location</dt><dd>{job.location || "Not set"} · {titleCase(job.work_mode)}</dd></div><div><dt><CalendarClock size={15} />Target date</dt><dd>{formatDate(job.target_date)}</dd></div><div><dt><CircleDollarSign size={15} />Budget</dt><dd>{formatMoney(job.compensation_min, job.compensation_currency)} – {formatMoney(job.compensation_max, job.compensation_currency)}</dd></div><div><dt><CheckCircle2 size={15} />Approval</dt><dd>{job.approved_by_name ? `${job.approved_by_name} · ${formatDate(job.approved_at)}` : "Pending"}</dd></div></dl></section>
      <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Interview design</p><h2>Pipeline stages</h2></div>{canManageJob ? <StageForm jobId={job.id} jobVersion={job.version} nextPosition={data.stages.length + 1} /> : null}</div><ol className="stage-list">{data.stages.map((stage) => <li key={stage.id}><span>{stage.position}</span><div><strong>{stage.name}</strong><small>{titleCase(stage.kind)} · {stage.sla_hours ? `${stage.sla_hours}h SLA` : "No SLA"} · {stage.required_scorecards} scorecard gate</small></div>{canManageJob ? <StageEditForm jobId={job.id} jobVersion={job.version} stage={stage} /> : null}</li>)}</ol></section>
      <section className="content-section span-all"><div className="section-heading"><div><p className="eyebrow">Decision quality</p><h2>{data.rubric?.name || "Rubric"}</h2></div><div className="button-row"><span className="badge neutral">Version {data.rubric?.version_number || 0}</span>{canManageJob ? <RubricForm jobId={job.id} jobVersion={job.version} name={data.rubric?.name || "Job rubric"} initialCriteria={rubricCriteria} /> : null}</div></div><div className="rubric-grid">{rubricCriteria.map((criterion, index) => <div className="rubric-item" key={criterion.id}><span>{index + 1}</span><div><strong>{criterion.label}</strong><small>{criterion.hard ? "Hard criterion" : `${criterion.max} points`}</small></div></div>)}</div></section>
    </div>
  </>;
}
