import {
  AlertTriangle, Bot, BriefcaseBusiness, CalendarDays, CheckCircle2, Download, FileText, Mail,
  MessageSquareText, NotebookPen, Phone, ShieldCheck, Sparkles
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ApplicationDetailsForm, CandidateNoteForm, CandidateRecordActions, CommunicationForm, InterviewForm, OfferAction, OfferForm, TaskForm
} from "@/app/components/candidate-actions";
import { RecruitingCopilot } from "@/app/components/copilot";
import { ApplicationTransition } from "@/app/components/job-actions";
import { PageHeader } from "@/app/components/page-header";
import { hasPermission, requirePageContext } from "@/lib/ats/authz";
import { getCandidateDetail, getSettingsData } from "@/lib/ats/data";
import { formatDate, formatDateTime, formatMoney, relativeAge, titleCase } from "@/lib/ats/format";

function asStrings(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }

export default async function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePageContext("candidates:read");
  const { id } = await params;
  const canSeeCompensation = hasPermission(context.role, "offers:read");
  const canSeePii = hasPermission(context.role, "candidates:pii");
  const [data, settings] = await Promise.all([
    getCandidateDetail(context.organization.id, id, canSeeCompensation, canSeePii, context.user.id),
    getSettingsData(context.organization.id)
  ]);
  if (!data.candidate) notFound();
  const candidate = data.candidate;
  const profile = candidate.profile || {};
  const contacts = (profile.contacts || {}) as Record<string, unknown>;
  const applications = data.applications;
  const primary = applications[0];
  const primaryStages = primary ? data.stages.filter((stage) => stage.job_id === primary.job_id) : [];
  const canDraftOffer = Boolean(primary && primary.current_stage_id === primaryStages.at(-1)?.id);
  const canManageApplications = hasPermission(context.role, "applications:manage");
  const canManageInterviews = hasPermission(context.role, "interviews:manage");
  const canManageTasks = hasPermission(context.role, "tasks:manage");
  const canUseAi = hasPermission(context.role, "ai:use");
  const skills = Object.entries((profile.skills || {}) as Record<string, unknown>).flatMap(([group, values]) => asStrings(values).map((value) => ({ group, value })));
  const existingProposals = data.proposals.map((proposal) => {
    const payload = proposal.payload as { summary?: unknown };
    return {
      id: proposal.id, kind: proposal.kind, title: proposal.title,
      summary: typeof payload.summary === "string" ? payload.summary : "Review the evidence before applying this proposal.",
      evidence: Array.isArray(proposal.evidence) ? proposal.evidence as Array<{ claim: string; quote: string; source: string }> : [],
      status: proposal.status
    };
  });
  const approvedArtifacts = existingProposals.filter((proposal) => proposal.status === "approved");
  const communicationProps = primary ? { applicationId: primary.id, templates: settings.communicationTemplates, candidateName: candidate.name, jobTitle: primary.job_title } : null;
  const pageActions = <>{hasPermission(context.role, "data:export") ? <a className="button secondary" href={`/api/candidates/${candidate.id}/export`}><Download size={16} />Export</a> : null}{hasPermission(context.role, "candidates:manage") ? <CandidateRecordActions candidateId={candidate.id} version={candidate.version} archived={Boolean(candidate.archived_at)} canDelete={hasPermission(context.role, "data:delete")} /> : null}</>;
  return <>
    <PageHeader backHref="/candidates" backLabel="Candidates" eyebrow={primary?.job_title || "Talent record"} title={candidate.name} description={`${profile.years == null ? "Experience requires confirmation" : `${profile.years} years reported`} · Added ${formatDate(candidate.created_at)}`} actions={pageActions} />
    {candidate.archived_at ? <div className="notice warning"><AlertTriangle size={18} /><div><strong>Archived candidate</strong><span>This record is excluded from active hiring views.</span></div></div> : null}
    <div className="candidate-layout">
      <div className="candidate-main">
        <section className="content-section candidate-overview">
          <div className="profile-strip"><div className="profile-avatar">{candidate.name.slice(0, 1).toUpperCase()}</div><div className="contact-stack">{asStrings(contacts.emails).map((email) => <a href={`mailto:${email}`} key={email}><Mail size={14} />{email}</a>)}{asStrings(contacts.phones).map((phone) => <a href={`tel:${phone}`} key={phone}><Phone size={14} />{phone}</a>)}{!asStrings(contacts.emails).length && !asStrings(contacts.phones).length ? <span>{canSeePii ? "Contact details not extracted" : "Contact details restricted"}</span> : null}</div><div className="skill-cloud">{skills.slice(0, 12).map((skill) => <span key={`${skill.group}-${skill.value}`}>{skill.value}</span>)}</div></div>
          {applications.map((application) => <div className="application-summary" key={application.id}><div><span className="application-icon"><BriefcaseBusiness size={17} /></span><div><Link href={`/jobs/${application.job_id}`}>{application.job_title}</Link><span>{application.stage_name || "No stage"} · <em className={`state-text ${application.state}`}>{titleCase(application.state)}</em></span></div></div><div className="score-cluster"><strong>{application.score == null ? "-" : Math.round(Number(application.score))}</strong><span>of {application.max_score == null ? "-" : Math.round(Number(application.max_score))}</span></div>{hasPermission(context.role, "applications:manage") ? <ApplicationTransition application={{ id: application.id, candidate_id: candidate.id, candidate_name: candidate.name, years: typeof profile.years === "number" ? profile.years : null, state: application.state, version: application.version, current_stage_id: application.current_stage_id, stage_name: application.stage_name, score: application.score, max_score: application.max_score, eligibility: application.eligibility, overdue: false, owner_name: null, source: application.source }} stages={data.stages.filter((stage) => stage.job_id === application.job_id)} /> : null}</div>)}
        </section>

        {primary ? <section className="content-section"><div className="section-heading"><div><p className="eyebrow">HR screening</p><h2>Application details</h2></div><div className="button-row">{canManageApplications && communicationProps ? <CommunicationForm {...communicationProps} /> : null}{canManageInterviews ? <InterviewForm application={primary} stages={data.stages} members={data.members} /> : null}{canManageTasks ? <TaskForm members={data.members} applicationId={primary.id} jobId={primary.job_id} /> : null}</div></div>{canManageApplications ? <ApplicationDetailsForm application={primary} members={data.members} /> : <dl className="detail-list"><div><dt>Consent</dt><dd>{titleCase(primary.consent_status)}</dd></div><div><dt>Availability</dt><dd>{formatDate(primary.availability_date)}</dd></div><div><dt>Notice period</dt><dd>{primary.notice_period_days == null ? "Not recorded" : `${primary.notice_period_days} days`}</dd></div></dl>}</section> : null}

        {primary ? <section className="content-section evaluation-section"><div className="section-heading"><div><p className="eyebrow">Resume evaluation</p><h2>Evidence and eligibility</h2></div>{primary.eligibility && primary.eligibility.experience_under_7 === false ? <span className="badge rejected"><AlertTriangle size={13} />Hard criterion flagged</span> : <span className="badge active"><CheckCircle2 size={13} />Human review required</span>}</div><div className="eligibility-grid">{primary.eligibility ? Object.entries(primary.eligibility).map(([key, value]) => <div key={key}><span>{titleCase(key)}</span><strong>{value === null ? "Unclear" : value === true ? "Yes" : value === false ? "No" : String(value)}</strong></div>) : null}</div><div className="evidence-matrix">{primary.evidence ? Object.entries(primary.evidence).map(([key, value]) => { const metric = value as { score?: number; evidence?: string[] }; return <article key={key}><div><strong>{titleCase(key)}</strong><span>{metric.score ?? 0}</span></div>{asStrings(metric.evidence).slice(0, 3).map((line) => <p key={line}>{line}</p>)}{!asStrings(metric.evidence).length ? <small>No direct evidence extracted</small> : null}</article>; }) : null}</div>{primary.gaps?.length ? <div className="gap-list">{primary.gaps.map((gap, index) => <span key={index}><AlertTriangle size={14} />{String(gap)}</span>)}</div> : null}</section> : null}

        {approvedArtifacts.length ? <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Approved AI artifacts</p><h2>Shared hiring context</h2></div></div><div className="artifact-list">{approvedArtifacts.map((proposal) => <article key={proposal.id}><span className="badge ai">{titleCase(proposal.kind)}</span><div><strong>{proposal.title}</strong><p>{proposal.summary}</p></div></article>)}</div></section> : null}

        <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Candidate touchpoints</p><h2>Communication history</h2></div>{canManageApplications && communicationProps ? <CommunicationForm {...communicationProps} /> : null}</div><div className="timeline">{data.communications.map((item) => <div className="timeline-item" key={item.id}><span className="timeline-marker"><MessageSquareText size={14} /></span><div><div className="timeline-head"><strong>{titleCase(item.channel)} · {titleCase(item.direction)}</strong><time>{formatDateTime(item.occurred_at)}</time></div>{item.subject ? <h3>{item.subject}</h3> : null}<p>{item.body}</p><small>{item.author_name || "System"}</small></div></div>)}{!data.communications.length ? <div className="empty-inline"><MessageSquareText size={18} />No communication logged</div> : null}</div></section>

        <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Internal context</p><h2>Notes</h2></div>{canManageApplications ? <CandidateNoteForm candidateId={candidate.id} candidateVersion={candidate.version} /> : null}</div><div className="timeline">{data.notes.map((note) => <div className="timeline-item" key={note.id}><span className="timeline-marker"><NotebookPen size={14} /></span><div><div className="timeline-head"><strong>{note.author_name || "System"}</strong><time>{formatDateTime(note.created_at)}</time></div><p>{note.body}</p></div></div>)}{!data.notes.length ? <div className="empty-inline"><NotebookPen size={18} />No internal notes</div> : null}</div></section>

        <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Interview plan</p><h2>Rounds and feedback</h2></div>{primary && canManageInterviews ? <InterviewForm application={primary} stages={data.stages} members={data.members} /> : null}</div><div className="interview-list">{data.interviews.map((interview) => <article key={interview.id}><div className="interview-icon"><CalendarDays size={18} /></div><div><strong>{interview.title}</strong><span>{interview.stage_name || titleCase(interview.kind)} · {formatDateTime(interview.starts_at)}</span></div><div><span className={`badge ${interview.status}`}>{titleCase(interview.status)}</span><small>{interview.submitted_scorecards}/{interview.participant_count} feedback</small></div></article>)}{!data.interviews.length ? <div className="empty-inline"><CalendarDays size={18} />No interviews scheduled</div> : null}</div></section>

        <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Compensation decision</p><h2>Offers</h2></div>{primary && canDraftOffer && hasPermission(context.role, "offers:manage") ? <OfferForm applicationId={primary.id} /> : null}</div><div className="offer-list">{data.offers.map((offer) => <article key={offer.id}><div><strong>{formatMoney(offer.compensation, offer.currency)}</strong><span>Start {formatDate(offer.proposed_start_date)}</span></div><span className={`badge ${offer.status}`}>{titleCase(offer.status)}</span><p>{offer.conditions || "No conditions recorded"}</p>{hasPermission(context.role, "offers:manage") ? <div className="button-row">{offer.status === "draft" ? <OfferAction id={offer.id} version={offer.version} action="submit" /> : null}{offer.status === "pending_approval" && hasPermission(context.role, "offers:approve") ? <OfferAction id={offer.id} version={offer.version} action="approve" /> : null}{offer.status === "approved" ? <OfferAction id={offer.id} version={offer.version} action="send" /> : null}{offer.status === "sent" ? <><OfferAction id={offer.id} version={offer.version} action="accept" /><OfferAction id={offer.id} version={offer.version} action="decline" /></> : null}</div> : null}</article>)}{!data.offers.length ? <div className="empty-inline"><ShieldCheck size={18} />No offer drafted</div> : null}</div></section>
      </div>

      <aside className="candidate-aside">
        {canUseAi ? <section className="content-section sticky-section"><div className="section-heading"><div><p className="eyebrow">Recruiting copilot</p><h2><Sparkles size={18} />AI review</h2></div></div>{primary ? <RecruitingCopilot applicationId={primary.id} providers={settings.providers.filter((item) => item.status === "active").map((item) => ({ provider: item.provider as "openai" | "anthropic", model: item.model }))} initialProposals={existingProposals} /> : <div className="empty-inline"><Bot size={18} />No application context</div>}</section> : null}
        <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Documents</p><h2>Resumes</h2></div></div><div className="document-list">{data.documents.map((document) => <a href={`/api/documents/${document.id}`} target="_blank" rel="noreferrer" key={document.id}><FileText size={18} /><span><strong>{document.file_name}</strong><small>{Math.ceil(document.size_bytes / 1024)} KB · {titleCase(document.extraction_status)}</small></span><Download size={15} /></a>)}</div>{data.documents[0]?.content_type === "application/pdf" ? <iframe className="resume-preview" title={`${candidate.name} resume`} src={`/api/documents/${data.documents[0].id}`} /> : null}</section>
        <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Follow-through</p><h2>Tasks</h2></div>{primary && canManageTasks ? <TaskForm members={data.members} applicationId={primary.id} jobId={primary.job_id} /> : null}</div><div className="compact-list">{data.tasks.map((task) => <div key={task.id}><span className={`status-dot ${task.status}`} /><div><strong>{task.title}</strong><small>{task.assigned_name || "Unassigned"} · {formatDate(task.due_at)}</small></div></div>)}</div></section>
        <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Audit trail</p><h2>Activity</h2></div></div><div className="compact-list activity-compact">{data.activity.slice(0, 20).map((event) => <div key={event.id}><span className="status-dot" /><div><strong>{titleCase(event.event_type.replaceAll(".", " "))}</strong><small>{event.actor_name || "System"} · {relativeAge(event.created_at)}</small></div></div>)}</div></section>
      </aside>
    </div>
  </>;
}
