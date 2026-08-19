"use client";

import { Archive, CalendarPlus, Check, FileUp, MessageSquarePlus, NotebookPen, Plus, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, FormStatus, Modal, useApiMutation } from "@/app/components/mutation";

type Member = { id: string; name: string; role: string };
type Stage = { id: string; job_id: string; name: string; kind: string; competency_template: string[] };
type Application = {
  id: string; job_id: string; job_title: string; version: number; source: string; consent_status: string;
  availability_date: string | null; notice_period_days: number | null; work_mode_preference: string | null;
  current_compensation: string | null; expected_compensation: string | null; compensation_currency: string;
  screening_suitability: string | null; role_interest: string | null; location_confirmed: boolean | null;
  follow_up_at: string | null;
  owner_user_id?: string | null;
};

export function CandidateDirectory({ candidates, piiVisible }: { candidates: Array<{ id: string; name: string; email: string | null; phone: string | null; years: number | null; archived_at: string | null; applications: number; active_applications: number; latest_job: string | null; latest_stage: string | null; latest_state: string | null }>; piiVisible: boolean }) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"active" | "all" | "archived">("active");
  const filtered = candidates.filter((candidate) => {
    const matches = `${candidate.name} ${candidate.email || ""} ${candidate.latest_job || ""}`.toLowerCase().includes(search.toLowerCase());
    const inScope = scope === "all" || (scope === "archived" ? Boolean(candidate.archived_at) : !candidate.archived_at);
    return matches && inScope;
  });
  return <section className="directory-section"><div className="section-toolbar"><input className="search-input" placeholder={piiVisible ? "Search name, email, or job" : "Search name or job"} aria-label="Search candidates" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="segmented"><button className={scope === "active" ? "active" : ""} onClick={() => setScope("active")}>Active</button><button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>All</button><button className={scope === "archived" ? "active" : ""} onClick={() => setScope("archived")}>Archived</button></div></div><div className="table-wrap"><table><thead><tr><th>Candidate</th><th>Experience</th><th>Current job</th><th>Stage</th><th>Applications</th><th>Status</th></tr></thead><tbody>{filtered.map((candidate) => <tr key={candidate.id} data-testid="candidate-row"><td><Link className="candidate-cell" href={`/candidates/${candidate.id}`}><span className="table-avatar">{candidate.name.slice(0, 1).toUpperCase()}</span><span><strong>{candidate.name}</strong><small>{candidate.email || candidate.phone || (piiVisible ? "Contact not extracted" : "Contact restricted")}</small></span></Link></td><td>{candidate.years == null ? "Unclear" : `${candidate.years} years`}</td><td>{candidate.latest_job || "No application"}</td><td>{candidate.latest_stage || "-"}</td><td>{candidate.applications}</td><td><span className={`badge ${candidate.archived_at ? "archived" : candidate.latest_state || "active"}`}>{candidate.archived_at ? "Archived" : (candidate.latest_state || "Active").replaceAll("_", " ")}</span></td></tr>)}</tbody></table></div>{!filtered.length ? <div className="empty-state"><strong>No candidates found</strong></div> : null}</section>;
}

export function ResumeUpload({ jobs }: { jobs: Array<{ id: string; title: string }> }) {
  const router = useRouter();
  const mutation = useApiMutation();
  const [duplicates, setDuplicates] = useState<Array<{ id: string; name: string; reason: string }>>([]);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  async function upload(form: HTMLFormElement, duplicateCandidateId?: string, createSeparate = false) {
    const data = new FormData(form);
    if (duplicateCandidateId) data.set("duplicateCandidateId", duplicateCandidateId);
    if (createSeparate) data.set("createSeparate", "true");
    const result = await mutation.mutate(async () => {
      try {
        return await apiRequest<{ candidateId: string }>("/api/candidates/upload", { method: "POST", body: data });
      } catch (error) {
        const body = (error as Error & { body?: { matches?: Array<{ id: string; name: string; reason: string }> } }).body;
        if (body?.matches) setDuplicates(body.matches);
        throw error;
      }
    }, "Candidate added");
    if (result) router.push(`/candidates/${result.candidateId}`);
  }

  return (
    <Modal title="Add candidate" size="medium" trigger={<button className="button primary"><FileUp size={17} />Upload resume</button>}>
      <form className="stack-form" ref={setFormElement} onSubmit={(event) => { event.preventDefault(); void upload(event.currentTarget); }}>
        <label className="field"><span>Resume</span><input name="resume" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
        <label className="field"><span>Candidate name</span><input name="name" placeholder="Extract from resume" /></label>
        <label className="field"><span>Job</span><select name="jobId" required defaultValue={jobs[0]?.id}>{jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label>
        <label className="field"><span>Source</span><select name="source" defaultValue="direct"><option value="direct">Direct</option><option value="LinkedIn">LinkedIn</option><option value="referral">Referral</option><option value="agency">Agency</option><option value="careers_page">Careers page</option></select></label>
        {duplicates.length ? <div className="duplicate-box"><strong>Possible duplicates</strong>{duplicates.map((item) => <button type="button" key={item.id} onClick={() => formElement && void upload(formElement, item.id)}><span>{item.name}</span><small>{item.reason}</small></button>)}<button type="button" className="text-button danger-text" onClick={() => formElement && void upload(formElement, undefined, true)}>Create a separate candidate</button></div> : null}
        <FormStatus error={mutation.error} success={mutation.success} />
        <div className="form-actions"><button className="button primary" type="submit" disabled={mutation.pending}><FileUp size={16} />{mutation.pending ? "Processing..." : "Add candidate"}</button></div>
      </form>
    </Modal>
  );
}

export function ApplicationDetailsForm({ application, members }: { application: Application; members: Member[] }) {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const dateTime = (name: string) => form.get(name) ? new Date(String(form.get(name))).toISOString() : null;
    await mutation.mutate(() => apiRequest(`/api/applications/${application.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: application.version, source: form.get("source"), referral: form.get("referral") || null,
        consentStatus: form.get("consentStatus"), availabilityDate: form.get("availabilityDate") || null,
        noticePeriodDays: form.get("noticePeriodDays") ? Number(form.get("noticePeriodDays")) : null,
        workModePreference: form.get("workModePreference") || null,
        currentCompensation: form.get("currentCompensation") ? Number(form.get("currentCompensation")) : null,
        expectedCompensation: form.get("expectedCompensation") ? Number(form.get("expectedCompensation")) : null,
        compensationCurrency: form.get("compensationCurrency"),
        screeningSuitability: form.get("screeningSuitability") || null,
        roleInterest: form.get("roleInterest") || null,
        locationConfirmed: form.get("locationConfirmed") === "true" ? true : form.get("locationConfirmed") === "false" ? false : null,
        followUpAt: dateTime("followUpAt"),
        ownerUserId: form.get("ownerUserId") || null
      })
    }), "Screening details saved");
  }
  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="field"><span>Source</span><input name="source" defaultValue={application.source} required /></label>
      <label className="field"><span>Referral</span><input name="referral" /></label>
      <label className="field"><span>Consent</span><select name="consentStatus" defaultValue={application.consent_status}><option value="unknown">Unknown</option><option value="recorded">Recorded</option><option value="declined">Declined</option></select></label>
      <label className="field"><span>Owner</span><select name="ownerUserId" defaultValue={application.owner_user_id || ""}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label className="field"><span>Available from</span><input name="availabilityDate" type="date" defaultValue={application.availability_date || ""} /></label>
      <label className="field"><span>Notice period (days)</span><input name="noticePeriodDays" type="number" min="0" max="730" defaultValue={application.notice_period_days ?? ""} /></label>
      <label className="field"><span>Work mode preference</span><select name="workModePreference" defaultValue={application.work_mode_preference || ""}><option value="">Not recorded</option><option value="onsite">Onsite</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select></label>
      <label className="field"><span>Suitability</span><select name="screeningSuitability" defaultValue={application.screening_suitability || ""}><option value="">Not assessed</option><option value="strong">Strong fit</option><option value="mixed">Mixed, investigate</option><option value="not_suitable">Not suitable</option></select></label>
      <label className="field"><span>Role interest</span><select name="roleInterest" defaultValue={application.role_interest || ""}><option value="">Not confirmed</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="declined">Declined</option></select></label>
      <label className="field"><span>Location confirmed</span><select name="locationConfirmed" defaultValue={application.location_confirmed == null ? "" : String(application.location_confirmed)}><option value="">Not confirmed</option><option value="true">Yes</option><option value="false">No</option></select></label>
      <label className="field"><span>Follow up</span><input name="followUpAt" type="datetime-local" /></label>
      <label className="field"><span>Current compensation</span><input name="currentCompensation" type="number" min="0" defaultValue={application.current_compensation ?? ""} /></label>
      <label className="field"><span>Expected compensation</span><input name="expectedCompensation" type="number" min="0" defaultValue={application.expected_compensation ?? ""} /></label>
      <label className="field"><span>Currency</span><input name="compensationCurrency" minLength={3} maxLength={3} defaultValue={application.compensation_currency} /></label>
      <div className="form-actions"><FormStatus error={mutation.error} success={mutation.success} /><button className="button primary" disabled={mutation.pending} type="submit"><Check size={16} />{mutation.pending ? "Saving..." : "Save screening"}</button></div>
    </form>
  );
}

type CommunicationTemplate = { id: string; name: string; channel: string; subject: string | null; body: string };

export function CommunicationForm({ applicationId, templates, candidateName, jobTitle }: { applicationId: string; templates: CommunicationTemplate[]; candidateName: string; jobTitle: string }) {
  const mutation = useApiMutation();
  const [channel, setChannel] = useState("call");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const personalize = (value: string) => value.replaceAll("{{candidate_name}}", candidateName).replaceAll("{{job_title}}", jobTitle);
  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setChannel(template.channel);
    setSubject(personalize(template.subject || ""));
    setBody(personalize(template.body));
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await mutation.mutate(() => apiRequest(`/api/applications/${applicationId}/communications`, {
      method: "POST", body: JSON.stringify({
        channel, direction: form.get("direction"), subject: subject || null, body,
        occurredAt: form.get("occurredAt") ? new Date(String(form.get("occurredAt"))).toISOString() : undefined
      })
    }), "Communication logged");
    if (result) { event.currentTarget.reset(); setChannel("call"); setSubject(""); setBody(""); }
  }
  return <Modal title="Log communication" trigger={<button className="button secondary"><MessageSquarePlus size={16} />Log communication</button>}><form className="stack-form" onSubmit={submit}>{templates.length ? <label className="field"><span>Template</span><select defaultValue="" onChange={(event) => applyTemplate(event.target.value)}><option value="">Start from scratch</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label> : null}<div className="form-grid compact-grid"><label className="field"><span>Channel</span><select name="channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="call">Call</option><option value="email">Email</option><option value="message">Message</option><option value="meeting">Meeting</option></select></label><label className="field"><span>Direction</span><select name="direction" defaultValue="outbound"><option value="outbound">Outbound</option><option value="inbound">Inbound</option><option value="internal">Internal</option></select></label></div><label className="field"><span>Occurred at</span><input name="occurredAt" type="datetime-local" /></label><label className="field"><span>Subject</span><input name="subject" value={subject} onChange={(event) => setSubject(event.target.value)} /></label><label className="field"><span>Notes</span><textarea name="body" rows={5} value={body} onChange={(event) => setBody(event.target.value)} required /></label><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions"><button className="button primary" disabled={mutation.pending}><Plus size={16} />{mutation.pending ? "Logging..." : "Add to timeline"}</button></div></form></Modal>;
}

export function CandidateNoteForm({ candidateId, candidateVersion }: { candidateId: string; candidateVersion: number }) {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await mutation.mutate(() => apiRequest(`/api/candidates/${candidateId}/note`, {
      method: "POST",
      body: JSON.stringify({ expectedCandidateVersion: candidateVersion, body: form.get("body") })
    }), "Note added");
    if (result) event.currentTarget.reset();
  }
  return <Modal title="Add internal note" trigger={<button className="button secondary"><NotebookPen size={16} />Add note</button>}><form className="stack-form" onSubmit={submit}><label className="field"><span>Note</span><textarea name="body" rows={6} maxLength={5000} required /></label><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions"><button className="button primary" disabled={mutation.pending}><Plus size={16} />{mutation.pending ? "Adding..." : "Add note"}</button></div></form></Modal>;
}

export function InterviewForm({ application, stages, members }: { application: Application; stages: Stage[]; members: Member[] }) {
  const mutation = useApiMutation();
  const eligibleStages = stages.filter((stage) => stage.job_id === application.job_id && ["phone_screen", "interview", "assessment"].includes(stage.kind));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const stageId = String(form.get("stageId"));
    const stage = stages.find((item) => item.id === stageId);
    const participantUserIds = form.getAll("participants").map(String);
    await mutation.mutate(() => apiRequest(`/api/applications/${application.id}/interviews`, {
      method: "POST", body: JSON.stringify({
        stageId, title: form.get("title"), kind: form.get("kind"), startsAt: new Date(String(form.get("startsAt"))).toISOString(),
        endsAt: form.get("endsAt") ? new Date(String(form.get("endsAt"))).toISOString() : null,
        meetingUrl: form.get("meetingUrl") || null, location: form.get("location") || null, participantUserIds,
        competencyAssignments: (stage?.competency_template || []).map((competency, index) => ({ competency, userId: participantUserIds[index % Math.max(participantUserIds.length, 1)] }))
      })
    }), "Interview scheduled");
  }
  return <Modal title="Schedule interview" size="large" trigger={<button className="button secondary"><CalendarPlus size={16} />Schedule interview</button>}><form className="form-grid" onSubmit={submit}><label className="field"><span>Round</span><select name="stageId" defaultValue={eligibleStages[0]?.id}>{eligibleStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="field"><span>Format</span><select name="kind" defaultValue="video"><option value="phone">Phone</option><option value="video">Video</option><option value="onsite">Onsite</option><option value="assessment">Assessment</option></select></label><label className="field span-2"><span>Title</span><input name="title" defaultValue={`${application.job_title} interview`} required /></label><label className="field"><span>Starts</span><input name="startsAt" type="datetime-local" required /></label><label className="field"><span>Ends</span><input name="endsAt" type="datetime-local" /></label><label className="field"><span>Meeting URL</span><input name="meetingUrl" type="url" /></label><label className="field"><span>Location</span><input name="location" /></label><fieldset className="field span-2 checkbox-field"><legend>Interviewers</legend><div className="checkbox-grid">{members.map((member) => <label key={member.id}><input type="checkbox" name="participants" value={member.id} /><span>{member.name}<small>{member.role.replaceAll("_", " ")}</small></span></label>)}</div></fieldset><div className="span-2"><FormStatus error={mutation.error} success={mutation.success} /></div><div className="form-actions span-2"><button className="button primary" disabled={mutation.pending}><CalendarPlus size={16} />{mutation.pending ? "Scheduling..." : "Schedule"}</button></div></form></Modal>;
}

export function TaskForm({ members, applicationId, jobId }: { members: Member[]; applicationId?: string; jobId?: string }) {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await mutation.mutate(() => apiRequest("/api/tasks", { method: "POST", body: JSON.stringify({ title: form.get("title"), description: form.get("description"), applicationId: applicationId || null, jobId: jobId || null, assignedUserId: form.get("assignedUserId") || null, dueAt: form.get("dueAt") ? new Date(String(form.get("dueAt"))).toISOString() : null, reminderAt: form.get("reminderAt") ? new Date(String(form.get("reminderAt"))).toISOString() : null, priority: form.get("priority") }) }), "Task created");
    if (result) event.currentTarget.reset();
  }
  return <Modal title="New task" trigger={<button className="button secondary"><Plus size={16} />New task</button>}><form className="stack-form" onSubmit={submit}><label className="field"><span>Task</span><input name="title" required /></label><label className="field"><span>Details</span><textarea name="description" rows={3} /></label><div className="form-grid compact-grid"><label className="field"><span>Assignee</span><select name="assignedUserId" defaultValue=""><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label className="field"><span>Priority</span><select name="priority" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div><div className="form-grid compact-grid"><label className="field"><span>Due</span><input name="dueAt" type="datetime-local" /></label><label className="field"><span>Reminder</span><input name="reminderAt" type="datetime-local" /></label></div><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions"><button className="button primary" disabled={mutation.pending}><Plus size={16} />{mutation.pending ? "Creating..." : "Create task"}</button></div></form></Modal>;
}

export function OfferForm({ applicationId }: { applicationId: string }) {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await mutation.mutate(() => apiRequest("/api/offers", { method: "POST", body: JSON.stringify({ applicationId, compensation: Number(form.get("compensation")), currency: form.get("currency"), proposedStartDate: form.get("startDate") || null, conditions: form.get("conditions") }) }), "Offer draft created");
  }
  return <Modal title="Draft offer" trigger={<button className="button secondary"><Plus size={16} />Draft offer</button>}><form className="stack-form" onSubmit={submit}><div className="form-grid compact-grid"><label className="field"><span>Compensation</span><input name="compensation" type="number" min="1" required /></label><label className="field"><span>Currency</span><input name="currency" defaultValue="INR" minLength={3} maxLength={3} /></label></div><label className="field"><span>Proposed start date</span><input name="startDate" type="date" /></label><label className="field"><span>Conditions</span><textarea name="conditions" rows={4} /></label><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions"><button className="button primary" disabled={mutation.pending}><Plus size={16} />Create draft</button></div></form></Modal>;
}

export function OfferAction({ id, version, action }: { id: string; version: number; action: "submit" | "approve" | "send" | "accept" | "decline" | "withdraw" }) {
  const mutation = useApiMutation();
  async function run() { const needsReason = ["decline", "withdraw"].includes(action); const reason = needsReason ? window.prompt("Reason") : undefined; if (needsReason && !reason) return; await mutation.mutate(() => apiRequest(`/api/offers/${id}/state`, { method: "POST", body: JSON.stringify({ action, expectedVersion: version, reason }) }), `Offer ${action} complete`); }
  return <span className="inline-action"><button className="button secondary small-button" onClick={run} disabled={mutation.pending}>{action === "approve" ? <Check size={15} /> : null}{mutation.pending ? "Working..." : action.replace(/^./, (value) => value.toUpperCase())}</button>{mutation.error ? <small className="inline-error">{mutation.error}</small> : null}</span>;
}

export function CandidateRecordActions({ candidateId, version, archived, canDelete }: { candidateId: string; version: number; archived: boolean; canDelete: boolean }) {
  const router = useRouter();
  const mutation = useApiMutation();
  async function action(type: "archive" | "restore" | "delete") { const reason = window.prompt(`Reason to ${type} this candidate`); if (!reason) return; if (type === "delete" && !window.confirm("Permanently delete this archived candidate and all related records?")) return; const result = await mutation.mutate(() => apiRequest(`/api/candidates/${candidateId}/record`, { method: "POST", body: JSON.stringify({ action: type, expectedVersion: version, reason }) }), type === "delete" ? "Candidate deleted" : "Candidate updated"); if (type === "delete" && result) router.push("/candidates"); }
  return <div className="button-row">{archived ? <button className="button secondary" onClick={() => void action("restore")}><RotateCcw size={16} />Restore</button> : <button className="button secondary" onClick={() => void action("archive")}><Archive size={16} />Archive</button>}{archived && canDelete ? <button className="button danger" onClick={() => void action("delete")}><Trash2 size={16} />Delete</button> : null}{mutation.error ? <small className="inline-error">{mutation.error}</small> : null}</div>;
}
