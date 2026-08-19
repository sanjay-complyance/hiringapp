"use client";

import { Check, ClipboardCheck, RotateCcw, XCircle } from "lucide-react";
import { apiRequest, FormStatus, Modal, useApiMutation } from "@/app/components/mutation";

export function TaskToggle({ id, version, status }: { id: string; version: number; status: string }) {
  const mutation = useApiMutation();
  const next = status === "completed" ? "open" : "completed";
  return <span className="inline-action"><button className="icon-button" title={next === "completed" ? "Complete task" : "Reopen task"} aria-label={next === "completed" ? "Complete task" : "Reopen task"} disabled={mutation.pending} onClick={() => void mutation.mutate(() => apiRequest(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ expectedVersion: version, status: next }) }), next === "completed" ? "Task completed" : "Task reopened")}>{next === "completed" ? <Check size={17} /> : <RotateCcw size={16} />}</button>{mutation.error ? <small className="inline-error">{mutation.error}</small> : null}</span>;
}

export function InterviewStateAction({ id, version, status }: { id: string; version: number; status: "completed" | "cancelled" }) {
  const mutation = useApiMutation();
  async function run() { const reason = status === "cancelled" ? window.prompt("Cancellation reason") : undefined; if (status === "cancelled" && !reason) return; await mutation.mutate(() => apiRequest(`/api/interviews/${id}`, { method: "PATCH", body: JSON.stringify({ expectedVersion: version, status, reason }) }), `Interview ${status}`); }
  return <button className="button secondary small-button" onClick={run} disabled={mutation.pending}>{status === "completed" ? <Check size={15} /> : <XCircle size={15} />}{mutation.pending ? "Working..." : status === "completed" ? "Complete" : "Cancel"}</button>;
}

export function ScorecardForm({
  interviewId,
  competencies,
  existingState,
  expectedVersion
}: {
  interviewId: string;
  competencies: string[];
  existingState: string | null;
  expectedVersion: number | null;
}) {
  const mutation = useApiMutation();
  const areas = competencies.length ? competencies : ["Role evidence", "Execution", "Communication", "Recommendation"];
  async function save(formElement: HTMLFormElement, submitNow: boolean) {
    const form = new FormData(formElement);
    const scores = Object.fromEntries(areas.map((area, index) => [area, Number(form.get(`score-${index}`))]));
    await mutation.mutate(() => apiRequest(`/api/interviews/${interviewId}/scorecard`, {
      method: "PUT",
      body: JSON.stringify({ scores, overallScore: Number(form.get("overallScore")), recommendation: form.get("recommendation"), evidence: form.get("evidence"), risks: form.get("risks"), dissent: form.get("dissent"), submit: submitNow, expectedVersion: expectedVersion || undefined })
    }), submitNow ? "Feedback submitted" : "Draft saved");
  }
  if (existingState === "submitted") return <span className="badge completed"><Check size={13} />Feedback submitted</span>;
  return <Modal title="Interview scorecard" size="large" trigger={<button className="button secondary small-button"><ClipboardCheck size={16} />{existingState === "draft" ? "Continue scorecard" : "Add scorecard"}</button>}><form className="stack-form" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget, true); }}>{areas.map((area, index) => <label className="score-field" key={area}><span>{area}</span><select name={`score-${index}`} defaultValue="3"><option value="1">1 - weak</option><option value="2">2 - below bar</option><option value="3">3 - meets bar</option><option value="4">4 - strong</option><option value="5">5 - exceptional</option></select></label>)}<div className="form-grid compact-grid"><label className="field"><span>Overall score</span><select name="overallScore" defaultValue="3"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label><label className="field"><span>Recommendation</span><select name="recommendation" defaultValue="mixed"><option value="strong_hire">Strong hire</option><option value="hire">Hire</option><option value="mixed">Mixed</option><option value="no_hire">No hire</option><option value="strong_no_hire">Strong no hire</option></select></label></div><label className="field"><span>Evidence</span><textarea name="evidence" minLength={10} rows={5} required /></label><div className="form-grid compact-grid"><label className="field"><span>Risks</span><textarea name="risks" rows={3} /></label><label className="field"><span>Dissent</span><textarea name="dissent" rows={3} /></label></div><FormStatus error={mutation.error} success={mutation.success} /><div className="form-actions split-actions"><button className="button secondary" type="button" disabled={mutation.pending} onClick={(event) => event.currentTarget.form && void save(event.currentTarget.form, false)}>Save draft</button><button className="button primary" type="submit" disabled={mutation.pending}><Check size={16} />Submit feedback</button></div></form></Modal>;
}
