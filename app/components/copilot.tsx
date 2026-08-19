"use client";

import { Bot, Check, Play, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { apiRequest, FormStatus, useApiMutation } from "@/app/components/mutation";
import { titleCase } from "@/lib/ats/format";

type Proposal = { id: string; kind: string; title: string; summary: string; evidence: Array<{ claim: string; quote: string; source: string }>; status: string };

export function RecruitingCopilot({ applicationId, providers, initialProposals = [] }: { applicationId: string; providers: Array<{ provider: "openai" | "anthropic"; model: string }>; initialProposals?: Proposal[] }) {
  const mutation = useApiMutation();
  const [answer, setAnswer] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals);
  const [threadId, setThreadId] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const result = await mutation.mutate(() => apiRequest<{ threadId: string; answer: string; proposals: Proposal[] }>("/api/agent/run", { method: "POST", body: JSON.stringify({ applicationId, provider: form.get("provider"), request: form.get("request"), threadId }) }), "Analysis ready");
    if (result) { setThreadId(result.threadId); setAnswer(result.answer); setProposals(result.proposals); }
  }

  async function review(id: string, action: "approve" | "reject") {
    const result = await mutation.mutate(() => apiRequest(`/api/agent/proposals/${id}`, { method: "POST", body: JSON.stringify({ action }) }), `Proposal ${action}d`);
    if (result) setProposals((items) => items.map((item) => item.id === id ? { ...item, status: action === "approve" ? "approved" : "rejected" } : item));
  }

  if (!providers.length) return <div className="empty-state compact-empty"><Bot size={22} /><strong>AI provider not connected</strong><span>An owner can connect OpenAI or Claude in Settings.</span></div>;
  return <div className="copilot-panel"><form className="copilot-compose" onSubmit={submit}><select name="provider" aria-label="AI provider">{providers.map((item) => <option key={item.provider} value={item.provider}>{item.provider === "openai" ? "OpenAI" : "Claude"} · {item.model}</option>)}</select><textarea name="request" rows={3} defaultValue="Evaluate this application against the active rubric. Identify evidence, gaps, and interview focus areas." required /><button className="button primary" disabled={mutation.pending}><Sparkles size={16} />{mutation.pending ? "Analyzing..." : "Run analysis"}</button></form><FormStatus error={mutation.error} success="" />{answer ? <div className="agent-answer"><div className="agent-label"><Bot size={16} />Private response</div><p>{answer}</p></div> : null}{proposals.map((proposal) => <article className="proposal-card" key={proposal.id}><div className="proposal-head"><span className="badge ai">{titleCase(proposal.kind)}</span><strong>{proposal.title}</strong><span className={`badge ${proposal.status}`}>{titleCase(proposal.status)}</span></div><p>{proposal.summary}</p>{proposal.evidence.length ? <details><summary>Evidence · {proposal.evidence.length}</summary><div className="evidence-list">{proposal.evidence.map((item, index) => <blockquote key={index}><strong>{item.claim}</strong><p>{item.quote}</p><cite>{item.source}</cite></blockquote>)}</div></details> : null}{proposal.status === "pending" ? <div className="proposal-actions"><button className="button secondary small-button" onClick={() => void review(proposal.id, "reject")}><X size={15} />Reject</button><button className="button primary small-button" onClick={() => void review(proposal.id, "approve")}><Check size={15} />Approve</button></div> : null}</article>)}</div>;
}

export function BatchCopilot({ jobId, providers, applicationCount }: { jobId: string; providers: Array<{ provider: "openai" | "anthropic" }>; applicationCount: number }) {
  const mutation = useApiMutation();
  const [progress, setProgress] = useState("");
  async function run(provider: "openai" | "anthropic") {
    const batch = await mutation.mutate(() => apiRequest<{ id: string; count: number }>("/api/agent/batches", { method: "POST", body: JSON.stringify({ jobId, provider }) }), "Batch created");
    if (!batch) return;
    let completed = 0;
    let completion: { applicationId: string; runId: string | null; succeeded: boolean; errorCode: string | null } | undefined;
    while (true) {
      const next = await apiRequest<{ applicationId: string | null; provider: "openai" | "anthropic"; done: boolean }>(`/api/agent/batches/${batch.id}/next`, { method: "POST", body: JSON.stringify({ completion }) });
      if (next.done || !next.applicationId) break;
      setProgress(`${completed + 1} of ${batch.count}`);
      try {
        const result = await apiRequest<{ runId: string }>("/api/agent/run", { method: "POST", body: JSON.stringify({ applicationId: next.applicationId, provider: next.provider, request: "Evaluate this application against the active rubric and create an evidence-backed evaluation proposal." }) });
        completion = { applicationId: next.applicationId, runId: result.runId, succeeded: true, errorCode: null };
      } catch {
        completion = { applicationId: next.applicationId, runId: null, succeeded: false, errorCode: "RUN_FAILED" };
      }
      completed += 1;
    }
    setProgress(`Completed ${completed}`);
  }
  if (!providers.length) return null;
  return <div className="batch-action"><button className="button secondary" disabled={mutation.pending || applicationCount === 0} onClick={() => void run(providers[0].provider)}><Play size={16} />Batch AI review</button>{progress ? <span>{progress}</span> : null}{mutation.error ? <small className="inline-error">{mutation.error}</small> : null}</div>;
}
