"use client";

import { KeyRound, Pencil, Plus, Save, Trash2, UserPlus } from "lucide-react";
import { apiRequest, FormStatus, Modal, useApiMutation } from "@/app/components/mutation";
import { useState } from "react";

const roles = ["owner", "admin", "founder", "recruiter", "hiring_manager", "interviewer", "viewer"];

export function MemberForm() {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const result = await mutation.mutate(() => apiRequest("/api/users", { method: "POST", body: JSON.stringify({ name: form.get("name"), email: form.get("email"), role: form.get("role") }) }), "Member added");
    if (result) event.currentTarget.reset();
  }
  return <Modal title="Add member" trigger={<button className="button primary"><UserPlus size={17} />Add member</button>}><form className="stack-form" onSubmit={submit}><label className="field"><span>Name</span><input name="name" required /></label><label className="field"><span>Email</span><input name="email" type="email" required /></label><label className="field"><span>Role</span><select name="role" defaultValue="interviewer">{roles.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></label><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions"><button className="button primary" disabled={mutation.pending}><Plus size={16} />Add member</button></div></form></Modal>;
}

export function MemberRoleAction({ id, role, active }: { id: string; role: string; active: boolean }) {
  const mutation = useApiMutation();
  async function changeRole(next: string) { await mutation.mutate(() => apiRequest(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ role: next }) }), "Role updated"); }
  async function toggle() { await mutation.mutate(() => apiRequest(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ active: !active }) }), active ? "Member deactivated" : "Member activated"); }
  return <div className="member-actions"><select aria-label="Member role" value={role} disabled={mutation.pending} onChange={(event) => void changeRole(event.target.value)}>{roles.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select><button className="button secondary small-button" onClick={toggle} disabled={mutation.pending}>{active ? "Deactivate" : "Activate"}</button>{mutation.error ? <small className="inline-error">{mutation.error}</small> : null}</div>;
}

export function ProviderForm({ provider }: { provider: "openai" | "anthropic" }) {
  const mutation = useApiMutation();
  const name = provider === "openai" ? "OpenAI" : "Claude";
  const model = provider === "openai" ? "gpt-5.6-luna" : "claude-sonnet-5";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await mutation.mutate(() => apiRequest("/api/settings/providers", { method: "POST", body: JSON.stringify({ provider, apiKey: form.get("apiKey"), model: form.get("model") }) }), `${name} connected`);
    if (!mutation.error) event.currentTarget.reset();
  }
  return <Modal title={`Connect ${name}`} trigger={<button className="button secondary"><KeyRound size={16} />Connect {name}</button>}><form className="stack-form" onSubmit={submit}><label className="field"><span>API key</span><input name="apiKey" type="password" autoComplete="off" required /></label><label className="field"><span>Model</span><input name="model" defaultValue={model} required /></label><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions"><button className="button primary" disabled={mutation.pending}><KeyRound size={16} />{mutation.pending ? "Testing..." : "Test and connect"}</button></div></form></Modal>;
}

export function RemoveProvider({ provider }: { provider: string }) {
  const mutation = useApiMutation();
  async function remove() { if (!window.confirm(`Remove the ${provider} connection?`)) return; await mutation.mutate(() => apiRequest(`/api/settings/providers/${provider}`, { method: "DELETE" }), "Provider removed"); }
  return <button className="icon-button danger-icon" onClick={remove} title="Remove provider" aria-label="Remove provider" disabled={mutation.pending}><Trash2 size={16} /></button>;
}

export function OrganizationSettings({ retentionDays, tokenLimit }: { retentionDays: number | null; tokenLimit: number }) {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await mutation.mutate(() => apiRequest("/api/settings/organization", { method: "PATCH", body: JSON.stringify({ retentionDays: form.get("retentionDays") ? Number(form.get("retentionDays")) : null, aiMonthlyTokenLimit: Number(form.get("tokenLimit")) }) }), "Organization settings saved"); }
  return <form className="form-grid settings-form" onSubmit={submit}><label className="field"><span>Candidate retention (days)</span><input name="retentionDays" type="number" min="30" max="3650" defaultValue={retentionDays ?? ""} placeholder="Not configured" /></label><label className="field"><span>Monthly AI token limit</span><input name="tokenLimit" type="number" min="0" max="1000000000" defaultValue={tokenLimit} /></label><div className="form-actions span-2"><FormStatus error={mutation.error} success={mutation.success} /><button className="button primary" disabled={mutation.pending}><Save size={16} />Save settings</button></div></form>;
}

export function StageForm({ jobId, jobVersion, nextPosition }: { jobId: string; jobVersion: number; nextPosition: number }) {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const competencies = String(form.get("competencies") || "").split("\n").map((item) => item.trim()).filter(Boolean); await mutation.mutate(() => apiRequest(`/api/jobs/${jobId}/stages`, { method: "POST", body: JSON.stringify({ expectedJobVersion: jobVersion, name: form.get("name"), stageKey: form.get("stageKey"), kind: form.get("kind"), position: Number(form.get("position")), slaHours: form.get("slaHours") ? Number(form.get("slaHours")) : null, requiredScorecards: Number(form.get("requiredScorecards")), competencies }) }), "Stage added"); }
  return <Modal title="Add pipeline stage" trigger={<button className="button secondary"><Plus size={16} />Add stage</button>}><form className="stack-form" onSubmit={submit}><label className="field"><span>Name</span><input name="name" required /></label><label className="field"><span>Stable key</span><input name="stageKey" pattern="[a-z0-9_]+" required /></label><div className="form-grid compact-grid"><label className="field"><span>Kind</span><select name="kind"><option value="review">Review</option><option value="phone_screen">Phone screen</option><option value="interview">Interview</option><option value="assessment">Assessment</option><option value="offer">Offer</option></select></label><label className="field"><span>Position</span><input name="position" type="number" min="1" max="30" defaultValue={nextPosition} /></label></div><div className="form-grid compact-grid"><label className="field"><span>SLA hours</span><input name="slaHours" type="number" min="1" /></label><label className="field"><span>Required scorecards</span><input name="requiredScorecards" type="number" min="0" defaultValue="0" /></label></div><label className="field"><span>Competencies</span><textarea name="competencies" rows={5} /></label><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions"><button className="button primary" disabled={mutation.pending}><Plus size={16} />Add stage</button></div></form></Modal>;
}

type StageConfig = {
  id: string;
  stage_key: string;
  name: string;
  kind: string;
  sla_hours: number | null;
  required_scorecards: number;
  competency_template: string[];
};

export function StageEditForm({ jobId, jobVersion, stage }: { jobId: string; jobVersion: number; stage: StageConfig }) {
  const mutation = useApiMutation();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const competencies = String(form.get("competencies") || "").split("\n").map((item) => item.trim()).filter(Boolean);
    await mutation.mutate(() => apiRequest(`/api/jobs/${jobId}/stages/${stage.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedJobVersion: jobVersion,
        name: form.get("name"),
        kind: form.get("kind"),
        slaHours: form.get("slaHours") ? Number(form.get("slaHours")) : null,
        requiredScorecards: Number(form.get("requiredScorecards")),
        competencies
      })
    }), "Stage updated");
  }
  return <Modal title={`Edit ${stage.name}`} trigger={<button className="icon-button" title={`Edit ${stage.name}`} aria-label={`Edit ${stage.name}`}><Pencil size={15} /></button>}><form className="stack-form" onSubmit={submit}><label className="field"><span>Name</span><input name="name" defaultValue={stage.name} required /></label><label className="field"><span>Stable key</span><input value={stage.stage_key} disabled /></label><label className="field"><span>Kind</span><select name="kind" defaultValue={stage.kind}><option value="review">Review</option><option value="phone_screen">Phone screen</option><option value="interview">Interview</option><option value="assessment">Assessment</option><option value="offer">Offer</option></select></label><div className="form-grid compact-grid"><label className="field"><span>SLA hours</span><input name="slaHours" type="number" min="1" defaultValue={stage.sla_hours ?? ""} /></label><label className="field"><span>Required scorecards</span><input name="requiredScorecards" type="number" min="0" defaultValue={stage.required_scorecards} /></label></div><label className="field"><span>Competencies</span><textarea name="competencies" rows={6} defaultValue={stage.competency_template.join("\n")} /></label><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions"><button className="button primary" disabled={mutation.pending}><Save size={16} />{mutation.pending ? "Saving..." : "Save stage"}</button></div></form></Modal>;
}

type RubricCriterion = { id: string; label: string; max: number; hard: boolean };

export function RubricForm({ jobId, jobVersion, name, initialCriteria }: { jobId: string; jobVersion: number; name: string; initialCriteria: RubricCriterion[] }) {
  const mutation = useApiMutation();
  const [criteria, setCriteria] = useState(initialCriteria);
  const update = (index: number, next: Partial<RubricCriterion>) => setCriteria((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.mutate(() => apiRequest(`/api/jobs/${jobId}/rubric`, {
      method: "POST",
      body: JSON.stringify({ expectedJobVersion: jobVersion, name: form.get("name"), criteria })
    }), "Rubric version created");
  }
  return <Modal title="Create rubric version" size="large" trigger={<button className="button secondary"><Pencil size={16} />Edit rubric</button>}><form className="stack-form" onSubmit={submit}><label className="field"><span>Version name</span><input name="name" defaultValue={name} required /></label><div className="rubric-editor"><div className="rubric-editor-head"><span>Criterion</span><span>Points</span><span>Hard gate</span><span /></div>{criteria.map((criterion, index) => <div className="rubric-editor-row" key={`${criterion.id}-${index}`}><div className="rubric-criterion-fields"><input aria-label={`Criterion ${index + 1} key`} value={criterion.id} pattern="[a-z0-9_]+" required onChange={(event) => update(index, { id: event.target.value })} /><input aria-label={`Criterion ${index + 1} label`} value={criterion.label} required onChange={(event) => update(index, { label: event.target.value })} /></div><input aria-label={`Criterion ${index + 1} points`} type="number" min={criterion.hard ? 0 : 1} max="20" value={criterion.max} onChange={(event) => update(index, { max: Number(event.target.value) })} /><label className="toggle-field"><input type="checkbox" checked={criterion.hard} onChange={(event) => update(index, { hard: event.target.checked, max: event.target.checked ? 0 : Math.max(criterion.max, 1) })} /><span>{criterion.hard ? "Required" : "Scored"}</span></label><button type="button" className="icon-button danger-icon" title="Remove criterion" aria-label="Remove criterion" disabled={criteria.length === 1} onClick={() => setCriteria((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}</div><button type="button" className="button secondary" onClick={() => setCriteria((current) => [...current, { id: `criterion_${current.length + 1}`, label: "New criterion", max: 5, hard: false }])}><Plus size={16} />Add criterion</button><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions"><button className="button primary" disabled={mutation.pending}><Save size={16} />{mutation.pending ? "Creating..." : "Create version"}</button></div></form></Modal>;
}
