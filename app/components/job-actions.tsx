"use client";

import { ArrowRight, Columns3, List, Pencil, Plus, Send, Settings2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, FormStatus, Modal, useApiMutation } from "@/app/components/mutation";
import { titleCase } from "@/lib/ats/format";

type Member = { id: string; name: string; role: string };
type Template = { id: string; name: string };

export function CreateJobForm({ members, templates }: { members: Member[]; templates: Template[] }) {
  const router = useRouter();
  const mutation = useApiMutation();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await mutation.mutate(() => apiRequest<{ job: { id: string } }>("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        title: form.get("title"), code: form.get("code") || null, department: form.get("department"),
        businessReason: form.get("businessReason"), openings: Number(form.get("openings")), priority: form.get("priority"),
        hiringManagerId: form.get("hiringManagerId") || null, recruiterId: form.get("recruiterId") || null,
        targetDate: form.get("targetDate") || null, employmentType: form.get("employmentType"),
        location: form.get("location"), workMode: form.get("workMode"),
        compensationMin: form.get("compensationMin") ? Number(form.get("compensationMin")) : null,
        compensationMax: form.get("compensationMax") ? Number(form.get("compensationMax")) : null,
        compensationCurrency: form.get("compensationCurrency"), templateId: form.get("templateId") || null
      })
    }), "Requisition created");
    if (result) router.push(`/jobs/${result.job.id}`);
  }

  return (
    <Modal title="New requisition" size="large" trigger={<button className="button primary"><Plus size={17} />New requisition</button>}>
      <form className="form-grid" onSubmit={submit}>
        <label className="field span-2"><span>Role title</span><input name="title" required maxLength={160} /></label>
        <label className="field"><span>Job code</span><input name="code" maxLength={40} /></label>
        <label className="field"><span>Department</span><input name="department" required maxLength={120} /></label>
        <label className="field span-2"><span>Business reason</span><textarea name="businessReason" rows={3} minLength={10} required /></label>
        <label className="field"><span>Openings</span><input name="openings" type="number" min="1" max="100" defaultValue="1" required /></label>
        <label className="field"><span>Priority</span><select name="priority" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label className="field"><span>Hiring manager</span><select name="hiringManagerId" defaultValue=""><option value="">Unassigned</option>{members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Recruiter</span><select name="recruiterId" defaultValue=""><option value="">Unassigned</option>{members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Target date</span><input name="targetDate" type="date" /></label>
        <label className="field"><span>Employment type</span><select name="employmentType" defaultValue="full_time"><option value="full_time">Full time</option><option value="contract">Contract</option><option value="internship">Internship</option></select></label>
        <label className="field"><span>Location</span><input name="location" maxLength={160} /></label>
        <label className="field"><span>Work mode</span><select name="workMode" defaultValue="hybrid"><option value="onsite">Onsite</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select></label>
        <label className="field"><span>Minimum compensation</span><input name="compensationMin" type="number" min="0" /></label>
        <label className="field"><span>Maximum compensation</span><input name="compensationMax" type="number" min="0" /></label>
        <label className="field"><span>Currency</span><input name="compensationCurrency" defaultValue="INR" minLength={3} maxLength={3} /></label>
        <label className="field"><span>Pipeline</span><select name="templateId" defaultValue={templates[0]?.id}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="span-2"><FormStatus error={mutation.error} success={mutation.success} /></div>
        <div className="form-actions span-2"><button className="button primary" disabled={mutation.pending} type="submit"><Plus size={17} />{mutation.pending ? "Creating..." : "Create draft"}</button></div>
      </form>
    </Modal>
  );
}

type EditableJob = {
  id: string; version: number; title: string; code: string | null; department: string; business_reason: string;
  openings: number; priority: string; target_date: string | null; employment_type: string; location: string;
  work_mode: string; compensation_min: string | null; compensation_max: string | null; compensation_currency: string;
  hiring_manager_id: string | null; recruiter_id: string | null;
};

export function EditJobForm({ job, members }: { job: EditableJob; members: Member[] }) {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.mutate(() => apiRequest(`/api/jobs/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: job.version,
        title: form.get("title"), code: form.get("code") || null, department: form.get("department"),
        businessReason: form.get("businessReason"), openings: Number(form.get("openings")), priority: form.get("priority"),
        hiringManagerId: form.get("hiringManagerId") || null, recruiterId: form.get("recruiterId") || null,
        targetDate: form.get("targetDate") || null, employmentType: form.get("employmentType"),
        location: form.get("location"), workMode: form.get("workMode"),
        compensationMin: form.get("compensationMin") ? Number(form.get("compensationMin")) : null,
        compensationMax: form.get("compensationMax") ? Number(form.get("compensationMax")) : null,
        compensationCurrency: form.get("compensationCurrency")
      })
    }), "Requisition updated");
  }
  return <Modal title="Edit requisition" size="large" trigger={<button className="button secondary"><Pencil size={16} />Edit requisition</button>}><form className="form-grid" onSubmit={submit}><label className="field span-2"><span>Role title</span><input name="title" defaultValue={job.title} required maxLength={160} /></label><label className="field"><span>Job code</span><input name="code" defaultValue={job.code || ""} maxLength={40} /></label><label className="field"><span>Department</span><input name="department" defaultValue={job.department} required maxLength={120} /></label><label className="field span-2"><span>Business reason</span><textarea name="businessReason" rows={3} defaultValue={job.business_reason} minLength={10} required /></label><label className="field"><span>Openings</span><input name="openings" type="number" min="1" max="100" defaultValue={job.openings} required /></label><label className="field"><span>Priority</span><select name="priority" defaultValue={job.priority}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><label className="field"><span>Hiring manager</span><select name="hiringManagerId" defaultValue={job.hiring_manager_id || ""}><option value="">Unassigned</option>{members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span>Recruiter</span><select name="recruiterId" defaultValue={job.recruiter_id || ""}><option value="">Unassigned</option>{members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span>Target date</span><input name="targetDate" type="date" defaultValue={job.target_date || ""} /></label><label className="field"><span>Employment type</span><select name="employmentType" defaultValue={job.employment_type}><option value="full_time">Full time</option><option value="contract">Contract</option><option value="internship">Internship</option></select></label><label className="field"><span>Location</span><input name="location" defaultValue={job.location} maxLength={160} /></label><label className="field"><span>Work mode</span><select name="workMode" defaultValue={job.work_mode}><option value="onsite">Onsite</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select></label><label className="field"><span>Minimum compensation</span><input name="compensationMin" type="number" min="0" defaultValue={job.compensation_min ?? ""} /></label><label className="field"><span>Maximum compensation</span><input name="compensationMax" type="number" min="0" defaultValue={job.compensation_max ?? ""} /></label><label className="field"><span>Currency</span><input name="compensationCurrency" defaultValue={job.compensation_currency} minLength={3} maxLength={3} /></label><div className="span-2"><FormStatus error={mutation.error} success={mutation.success} /></div><div className="form-actions span-2"><button className="button primary" disabled={mutation.pending}><Pencil size={16} />{mutation.pending ? "Saving..." : "Save requisition"}</button></div></form></Modal>;
}

export function JobStateButton({ jobId, version, action, label }: { jobId: string; version: number; action: "submit" | "approve" | "pause" | "reopen" | "close"; label: string }) {
  const mutation = useApiMutation();
  const needsReason = ["pause", "reopen", "close"].includes(action);
  async function run() {
    const reason = needsReason ? window.prompt(`Reason to ${action} this job`) : undefined;
    if (needsReason && !reason) return;
    await mutation.mutate(() => apiRequest(`/api/jobs/${jobId}/state`, { method: "POST", body: JSON.stringify({ action, expectedVersion: version, reason }) }), `${label} complete`);
  }
  const Icon = action === "approve" ? ShieldCheck : action === "submit" ? Send : Settings2;
  return <span className="inline-action"><button className={`button ${action === "approve" ? "primary" : "secondary"}`} onClick={run} disabled={mutation.pending}><Icon size={16} />{mutation.pending ? "Working..." : label}</button>{mutation.error ? <small className="inline-error">{mutation.error}</small> : null}</span>;
}

type Stage = { id: string; name: string; stage_key: string; position: number };
type PipelineApplication = {
  id: string; candidate_id: string; candidate_name: string; years: number | null; state: string; version: number;
  current_stage_id: string | null; stage_name: string | null; score: string | null; max_score: string | null;
  eligibility: Record<string, unknown> | null; overdue: boolean; owner_name: string | null; source: string;
};

export function ApplicationTransition({ application, stages, compact = false }: { application: PipelineApplication; stages: Stage[]; compact?: boolean }) {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const action = String(form.get("action"));
    await mutation.mutate(() => apiRequest(`/api/applications/${application.id}/transition`, {
      method: "POST",
      body: JSON.stringify({
        action,
        targetStageId: form.get("targetStageId") || null,
        expectedVersion: application.version,
        reason: form.get("reason") || undefined,
        evidence: form.get("evidence") || undefined,
        risks: form.get("risks") || undefined,
        dissent: form.get("dissent") || undefined,
        overrideReason: form.get("overrideReason") || undefined
      })
    }), "Application updated");
  }
  return (
    <Modal title={`Update ${application.candidate_name}`} size="medium" trigger={<button className={compact ? "icon-button" : "button secondary"} title="Update application" aria-label={compact ? "Update application" : undefined}><ArrowRight size={16} />{compact ? null : "Update"}</button>}>
      <form className="stack-form" onSubmit={submit}>
        <label className="field"><span>Action</span><select name="action" defaultValue="move"><option value="move">Move to stage</option><option value="reactivate">Reactivate</option><option value="hold">Put on hold</option><option value="reject">Reject</option><option value="withdraw">Withdraw</option><option value="hire">Hire</option></select></label>
        <label className="field"><span>Destination stage</span><select name="targetStageId" defaultValue={application.current_stage_id ?? stages[0]?.id}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
        <label className="field"><span>Decision reason</span><textarea name="reason" rows={2} /></label>
        <label className="field"><span>Evidence</span><textarea name="evidence" rows={3} /></label>
        <div className="form-grid compact-grid"><label className="field"><span>Risks</span><textarea name="risks" rows={2} /></label><label className="field"><span>Dissent</span><textarea name="dissent" rows={2} /></label></div>
        <label className="field"><span>Gate override reason</span><input name="overrideReason" /></label>
        <FormStatus error={mutation.error} success={mutation.success} />
        <div className="form-actions"><button className="button primary" disabled={mutation.pending} type="submit"><ArrowRight size={16} />{mutation.pending ? "Updating..." : "Apply update"}</button></div>
      </form>
    </Modal>
  );
}

export function PipelineBoard({ applications, stages, canManage }: { applications: PipelineApplication[]; stages: Stage[]; canManage: boolean }) {
  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const filtered = applications.filter((application) => application.candidate_name.toLowerCase().includes(query.toLowerCase()));
  const score = (application: PipelineApplication) => application.score == null ? "Unscored" : `${Math.round(Number(application.score))}/${Math.round(Number(application.max_score || 0))}`;

  return (
    <section className="pipeline-section">
      <div className="section-toolbar">
        <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidates" aria-label="Search candidates" />
        <div className="segmented" aria-label="Pipeline view"><button className={view === "board" ? "active" : ""} onClick={() => setView("board")} title="Board view"><Columns3 size={16} />Board</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} title="List view"><List size={16} />List</button></div>
      </div>
      {view === "board" ? (
        <div className="pipeline-board">
          {stages.map((stage) => {
            const stageApps = filtered.filter((application) => application.current_stage_id === stage.id && application.state === "active");
            return <div className="pipeline-column" key={stage.id}><div className="pipeline-column-head"><strong>{stage.name}</strong><span>{stageApps.length}</span></div><div className="pipeline-stack">{stageApps.map((application) => <article className="candidate-card" key={application.id} data-testid="candidate-card"><div className="candidate-card-top"><span className={`status-dot ${application.overdue ? "danger" : ""}`} /><Link href={`/candidates/${application.candidate_id}`}>{application.candidate_name}</Link>{canManage ? <ApplicationTransition application={application} stages={stages} compact /> : null}</div><div className="candidate-meta"><span>{application.years == null ? "Experience unclear" : `${application.years} yrs`}</span><span>{score(application)}</span></div><div className="candidate-card-foot"><span>{application.owner_name || "Unassigned"}</span>{application.overdue ? <em>Overdue</em> : null}</div></article>)}</div></div>;
          })}
          <div className="pipeline-column secondary-column"><div className="pipeline-column-head"><strong>Hold</strong><span>{filtered.filter((item) => item.state === "on_hold").length}</span></div><div className="pipeline-stack">{filtered.filter((item) => item.state === "on_hold").map((application) => <article className="candidate-card muted-card" key={application.id}><div className="candidate-card-top"><Link href={`/candidates/${application.candidate_id}`}>{application.candidate_name}</Link>{canManage ? <ApplicationTransition application={application} stages={stages} compact /> : null}</div><div className="candidate-meta"><span>{score(application)}</span><span>{application.source}</span></div></article>)}</div></div>
        </div>
      ) : (
        <div className="table-wrap"><table><thead><tr><th>Candidate</th><th>Stage</th><th>Status</th><th>Experience</th><th>Score</th><th>Owner</th>{canManage ? <th /> : null}</tr></thead><tbody>{filtered.map((application) => <tr key={application.id}><td><Link className="table-link" href={`/candidates/${application.candidate_id}`}>{application.candidate_name}</Link></td><td>{application.stage_name || "No stage"}</td><td><span className={`badge ${application.state}`}>{titleCase(application.state)}</span></td><td>{application.years == null ? "Unclear" : `${application.years} yrs`}</td><td>{score(application)}</td><td>{application.owner_name || "Unassigned"}</td>{canManage ? <td><ApplicationTransition application={application} stages={stages} compact /></td> : null}</tr>)}</tbody></table></div>
      )}
      {!filtered.length ? <div className="empty-state"><strong>No matching applications</strong></div> : null}
    </section>
  );
}
