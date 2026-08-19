import { CalendarDays, ExternalLink, Phone, UsersRound, Video } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/app/components/page-header";
import { InterviewStateAction, ScorecardForm } from "@/app/components/operational-actions";
import { hasPermission, requirePageContext } from "@/lib/ats/authz";
import { getInterviews } from "@/lib/ats/data";
import { formatDateTime, titleCase } from "@/lib/ats/format";

export default async function InterviewsPage() {
  const context = await requirePageContext("candidates:read");
  const interviews = await getInterviews(context.organization.id, context.user.id);
  const canManageInterviews = hasPermission(context.role, "interviews:manage");
  const canSubmitScorecards = hasPermission(context.role, "scorecards:submit");
  const canScoreUnassigned = ["owner", "admin", "founder", "recruiter"].includes(context.role);
  const canScore = (interview: (typeof interviews)[number]) => canSubmitScorecards && (interview.is_participant || canScoreUnassigned);
  const upcoming = interviews.filter((item) => item.status === "scheduled" && item.starts_at && new Date(item.starts_at) >= new Date());
  const awaiting = interviews.filter((item) => canScore(item) && ["scheduled", "completed"].includes(item.status) && item.my_scorecard_state !== "submitted");
  return <>
    <PageHeader eyebrow="Structured interviews" title="Interviews" description={`${upcoming.length} upcoming · ${awaiting.length} awaiting your feedback`} />
    <section className="metric-grid compact-metrics"><article className="metric-card blue"><div><span>Upcoming</span><strong>{upcoming.length}</strong></div><CalendarDays size={20} /></article><article className="metric-card amber"><div><span>Feedback due</span><strong>{awaiting.length}</strong></div><UsersRound size={20} /></article><article className="metric-card green"><div><span>Completed</span><strong>{interviews.filter((item) => item.status === "completed").length}</strong></div><CalendarDays size={20} /></article></section>
    <section className="interviews-page-list">{interviews.map((interview) => {
      const assignments = interview.competency_assignments || [];
      const mine = assignments.filter((item) => item.userId === context.user.id).map((item) => item.competency);
      const competencies = mine.length ? mine : [...new Set(assignments.map((item) => item.competency))];
      const Icon = interview.kind === "phone" ? Phone : Video;
      return <article key={interview.id} className="interview-row"><div className="interview-date"><strong>{interview.starts_at ? new Date(interview.starts_at).getDate() : "-"}</strong><span>{interview.starts_at ? new Date(interview.starts_at).toLocaleString("en-IN", { month: "short" }) : "TBD"}</span></div><div className="interview-detail"><div><span className="round-icon"><Icon size={15} /></span><strong>{interview.title}</strong><span className={`badge ${interview.status}`}>{titleCase(interview.status)}</span></div><Link href={`/candidates/${interview.candidate_id}`}>{interview.candidate_name}</Link><p>{interview.job_title} · {interview.stage_name || titleCase(interview.kind)} · {formatDateTime(interview.starts_at)}</p><div className="participant-row">{interview.participants.map((name) => <span key={name}>{name}</span>)}</div></div><div className="interview-actions">{interview.meeting_url ? <a className="button secondary small-button" href={interview.meeting_url} target="_blank" rel="noreferrer"><ExternalLink size={15} />Join</a> : null}{canScore(interview) ? <ScorecardForm interviewId={interview.id} competencies={competencies} existingState={interview.my_scorecard_state} expectedVersion={interview.my_scorecard_version} /> : null}{canManageInterviews && interview.status === "scheduled" ? <><InterviewStateAction id={interview.id} version={interview.version} status="completed" /><InterviewStateAction id={interview.id} version={interview.version} status="cancelled" /></> : null}</div></article>;
    })}</section>
    {!interviews.length ? <div className="empty-state"><CalendarDays size={28} /><strong>No interviews scheduled</strong></div> : null}
  </>;
}
