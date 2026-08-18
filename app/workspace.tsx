"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Filter,
  ListChecks,
  LogOut,
  Search,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Candidate, CandidateWorkflow, EvaluationData, MetricId, RoundScorecard, User } from "@/lib/types";

type SortMode = "rank" | "score" | "name" | "years";
type BandMode = "all" | "advance" | "manual" | "near" | "reject";
type Tab = "overview" | "scorecards" | "pdf" | "process";

const metricOrder: MetricId[] = [
  "full_stack_production",
  "backend_api_database_depth",
  "testing_debugging_production_support",
  "security_reliability_awareness",
  "ownership_mentoring_communication",
  "agentic_tool_usage_or_interest"
];

const statusLabels: Record<CandidateWorkflow["status"], string> = {
  new: "New",
  round1: "Round 1",
  round2: "Round 2",
  round3: "Round 3",
  round4: "Round 4",
  references: "References",
  hire: "Hire",
  no_hire: "No hire",
  hold: "Hold"
};

function defaultWorkflow(): CandidateWorkflow {
  return {
    status: "new",
    ownerUserId: "",
    notes: "",
    roundScores: {},
    roundNotes: {}
  };
}

function actionFor(candidate: Candidate): BandMode {
  const score = candidate.stage0.score;
  const strictPass = candidate.stage0.pass_bar;
  const planPass = candidate.stage0.hiring_plan_pass_bar ?? 14;
  if (score >= strictPass) return "advance";
  if (score >= planPass) return "manual";
  if (score >= Math.max(0, planPass - 3)) return "near";
  return "reject";
}

function actionLabel(action: BandMode) {
  if (action === "advance") return "Strict advance";
  if (action === "manual") return "Manual hold";
  if (action === "near") return "Near miss";
  if (action === "reject") return "Reject";
  return "All";
}

function scoreClass(score: number) {
  if (score >= 17) return "score strong";
  if (score >= 14) return "score pass";
  if (score >= 11) return "score borderline";
  return "score reject";
}

function sortedCandidates(candidates: Candidate[], sortMode: SortMode) {
  return [...candidates].sort((a, b) => {
    if (sortMode === "name") return a.name.localeCompare(b.name);
    if (sortMode === "years") return (b.years ?? -1) - (a.years ?? -1) || a.rank - b.rank;
    if (sortMode === "score") return b.stage0.score - a.stage0.score || a.rank - b.rank;
    return a.rank - b.rank;
  });
}

function roundTotal(workflow: CandidateWorkflow, roundId: string) {
  const scores = workflow.roundScores[roundId] ?? {};
  return Object.values(scores).reduce((sum, score) => sum + Number(score || 0), 0);
}

function finalTotal(candidate: Candidate, workflow: CandidateWorkflow) {
  return (
    candidate.stage0.score +
    roundTotal(workflow, "round1") +
    roundTotal(workflow, "round2") +
    roundTotal(workflow, "round3") +
    roundTotal(workflow, "round4")
  );
}

function decisionGuide(total: number) {
  if (total >= 145) return "Strong hire";
  if (total >= 128) return "Hire";
  if (total >= 115) return "Lean hire";
  if (total >= 98) return "Lean no-hire";
  return "No-hire";
}

function skillsFor(candidate: Candidate) {
  return Object.entries(candidate.skills)
    .flatMap(([group, values]) => values.slice(0, 5).map((value) => `${group.replace("_", " ")}: ${value}`))
    .slice(0, 18);
}

export function HiringWorkspace({ data }: { data: EvaluationData }) {
  const users = data.users ?? [];
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("rank");
  const [bandMode, setBandMode] = useState<BandMode>("all");
  const [selectedId, setSelectedId] = useState(data.candidates[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("overview");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [workflow, setWorkflow] = useState<Record<string, CandidateWorkflow>>(() =>
    Object.fromEntries(data.candidates.map((candidate) => [candidate.id, candidate.workflow ?? defaultWorkflow()]))
  );
  const currentUserId = currentUser?.id ?? "";

  useEffect(() => {
    const savedEmail = window.localStorage.getItem("hiringUserEmail");
    if (!savedEmail) return;
    const savedUser = users.find((user) => user.email.toLowerCase() === savedEmail.toLowerCase());
    if (savedUser) setCurrentUser(savedUser);
  }, [users]);

  const stats = useMemo(() => {
    const buckets = { advance: 0, manual: 0, near: 0, reject: 0 };
    data.candidates.forEach((candidate) => {
      buckets[actionFor(candidate) as keyof typeof buckets] += 1;
    });
    return buckets;
  }, [data.candidates]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortedCandidates(data.candidates, sortMode).filter((candidate) => {
      const action = actionFor(candidate);
      if (bandMode === "reject" && action !== "reject" && action !== "near") return false;
      if (bandMode !== "all" && bandMode !== "reject" && bandMode !== action) return false;
      if (!q) return true;
      const haystack = [
        candidate.name,
        candidate.file,
        candidate.stage0.band,
        candidate.recent_titles.join(" "),
        Object.values(candidate.skills).flat().join(" ")
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [data.candidates, sortMode, bandMode, query]);

  const selected = data.candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0] ?? data.candidates[0];
  const selectedWorkflow = workflow[selected.id] ?? defaultWorkflow();
  const selectedIndex = candidates.findIndex((candidate) => candidate.id === selected.id);
  const previousCandidate = candidates[selectedIndex - 1];
  const nextCandidate = candidates[selectedIndex + 1];

  function updateWorkflow(next: Partial<CandidateWorkflow>) {
    setWorkflow((current) => ({
      ...current,
      [selected.id]: {
        ...defaultWorkflow(),
        ...current[selected.id],
        ...next
      }
    }));
  }

  async function persist(path: string, body: Record<string, unknown>) {
    if (!currentUserId) throw new Error("Login is required before saving hiring actions");
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, actorUserId: currentUserId })
    });
    if (!response.ok) throw new Error(`Failed to save ${path}`);
  }

  function setCandidateStatus(status: CandidateWorkflow["status"]) {
    const fromStatus = selectedWorkflow.status;
    updateWorkflow({ status });
    void persist(`/api/candidates/${selected.id}/status`, { status, fromStatus });
  }

  function setCandidateOwner(ownerUserId: string) {
    updateWorkflow({ ownerUserId });
    void persist(`/api/candidates/${selected.id}/owner`, { ownerUserId });
  }

  function saveCandidateNote(notes: string) {
    updateWorkflow({ notes });
    void persist(`/api/candidates/${selected.id}/note`, { body: notes });
  }

  function updateRoundScore(roundId: string, areaId: string, score: number) {
    setWorkflow((current) => {
      const candidateWorkflow = { ...defaultWorkflow(), ...current[selected.id] };
      return {
        ...current,
        [selected.id]: {
          ...candidateWorkflow,
          roundScores: {
            ...candidateWorkflow.roundScores,
            [roundId]: {
              ...(candidateWorkflow.roundScores[roundId] ?? {}),
              [areaId]: score
            }
          }
        }
      };
    });
    void persist(`/api/candidates/${selected.id}/round-score`, { roundId, areaId, score });
  }

  function updateRoundNote(roundId: string, note: string) {
    setWorkflow((current) => {
      const candidateWorkflow = { ...defaultWorkflow(), ...current[selected.id] };
      return {
        ...current,
        [selected.id]: {
          ...candidateWorkflow,
          roundNotes: {
            ...candidateWorkflow.roundNotes,
            [roundId]: note
          }
        }
      };
    });
    void persist(`/api/candidates/${selected.id}/round-note`, { roundId, note });
  }

  if (!currentUser) {
    return <LoginScreen data={data} users={users} onLogin={setCurrentUser} />;
  }

  return (
    <main className="workspace">
      <header className="appHeader">
        <div className="brandBlock">
          <p className="eyebrow">Senior Software Developer</p>
          <h1>Resume Triage & Hiring Flow</h1>
          <p>Strict resume screen, evidence view, PDF review, and interview scorecards in one place.</p>
        </div>
        <div className="summaryTiles" aria-label="Strict resume screen summary">
          <Stat label="Reviewed" value={data.candidates.length.toString()} />
          <Stat label="Advance" value={stats.advance.toString()} tone="good" />
          <Stat label="Manual" value={stats.manual.toString()} tone="warn" />
          <Stat label="Reject" value={(stats.near + stats.reject).toString()} tone="bad" />
        </div>
        <UserBadge user={currentUser} onLogout={() => {
          window.localStorage.removeItem("hiringUserEmail");
          setCurrentUser(null);
        }} />
      </header>

      <section className="reviewShell">
        <aside className="queuePanel">
          <div className="queueControls">
            <label className="searchBox">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, tech, file" />
            </label>
            <div className="bucketTabs" aria-label="Candidate buckets">
              <BucketButton active={bandMode === "all"} label="All" count={data.candidates.length} onClick={() => setBandMode("all")} />
              <BucketButton active={bandMode === "advance"} label="Advance" count={stats.advance} onClick={() => setBandMode("advance")} />
              <BucketButton active={bandMode === "manual"} label="Manual" count={stats.manual} onClick={() => setBandMode("manual")} />
              <BucketButton active={bandMode === "reject"} label="Reject" count={stats.near + stats.reject} onClick={() => setBandMode("reject")} />
            </div>
            <label className="selectControl">
              <Filter size={16} />
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="rank">Rank order</option>
                <option value="score">Highest score</option>
                <option value="years">Years mentioned</option>
                <option value="name">Name A-Z</option>
              </select>
            </label>
            <AddUserForm currentUserId={currentUserId} />
            <UploadResumeForm currentUserId={currentUserId} />
          </div>

          <div className="candidateList" aria-label="Candidates">
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                className={candidate.id === selected.id ? "candidateRow selected" : "candidateRow"}
                onClick={() => setSelectedId(candidate.id)}
              >
                <span className="rank">#{candidate.rank}</span>
                <span className="candidateMain">
                  <span className="candidateName">{candidate.name}</span>
                  <span className="candidateSub">
                    {candidate.years ? `${candidate.years}+ yrs` : "years unclear"} · {actionLabel(actionFor(candidate))}
                  </span>
                </span>
                <span className={scoreClass(candidate.stage0.score)}>{candidate.stage0.score}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="candidateWorkspace">
          <CandidateHero
            candidate={selected}
            workflow={selectedWorkflow}
            users={users}
            onStatus={setCandidateStatus}
            onOwner={setCandidateOwner}
            onQuickStatus={setCandidateStatus}
            onPrevious={previousCandidate ? () => setSelectedId(previousCandidate.id) : undefined}
            onNext={nextCandidate ? () => setSelectedId(nextCandidate.id) : undefined}
          />

          <nav className="tabs" aria-label="Candidate review tabs">
            <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<ClipboardCheck size={16} />} label="Review" />
            <TabButton active={tab === "scorecards"} onClick={() => setTab("scorecards")} icon={<ListChecks size={16} />} label="Rounds" />
            <TabButton active={tab === "pdf"} onClick={() => setTab("pdf")} icon={<FileText size={16} />} label="PDF" />
            <TabButton active={tab === "process"} onClick={() => setTab("process")} icon={<ShieldCheck size={16} />} label="Process" />
          </nav>

          {tab === "overview" && (
            <Overview
              candidate={selected}
              data={data}
              workflow={selectedWorkflow}
              onNotes={(notes) => updateWorkflow({ notes })}
              onSaveNotes={saveCandidateNote}
            />
          )}
          {tab === "scorecards" && (
            <Scorecards
              candidate={selected}
              data={data}
              workflow={selectedWorkflow}
              onScore={updateRoundScore}
              onNote={updateRoundNote}
            />
          )}
          {tab === "pdf" && <PdfView candidate={selected} />}
          {tab === "process" && <ProcessGuide data={data} candidate={selected} workflow={selectedWorkflow} />}
        </section>
      </section>
    </main>
  );
}

function LoginScreen({ data, users, onLogin }: { data: EvaluationData; users: User[]; onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(payload.error ?? "Login failed");
      return;
    }
    window.localStorage.setItem("hiringUserEmail", payload.user.email);
    onLogin(payload.user);
  }

  return (
    <main className="loginScreen">
      <section className="loginPanel">
        <div>
          <p className="eyebrow">Senior Software Developer</p>
          <h1>Resume Triage & Hiring Flow</h1>
          <p>Enter your work email to review candidates and record hiring actions under your account.</p>
        </div>
        <form onSubmit={submit} className="loginForm">
          <label>
            <span>Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder="name@complyance.io"
              autoFocus
              required
            />
          </label>
          {error && <p className="formError">{error}</p>}
          <button type="submit" disabled={saving}>
            {saving ? "Logging in..." : "Log in"}
          </button>
        </form>
        <div className="loginMeta">
          <Stat label="Candidates" value={data.candidates.length.toString()} />
          <Stat label="Users" value={users.length.toString()} />
        </div>
      </section>
    </main>
  );
}

function UserBadge({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="userBadge">
      <div>
        <span>Logged in</span>
        <strong>{user.name}</strong>
        <small>{user.email}</small>
      </div>
      <button onClick={onLogout} title="Log out">
        <LogOut size={16} />
      </button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BucketButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function AddUserForm({ currentUserId }: { currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("Reviewer");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, role, actorUserId: currentUserId })
    });
    if (!response.ok) return;
    window.location.reload();
  }

  return (
    <details className="inlineForm" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Add user</summary>
      <form onSubmit={submit}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" required />
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@complyance.io" type="email" required />
        <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Role" required />
        <button type="submit">Save user</button>
      </form>
    </details>
  );
}

function UploadResumeForm({ currentUserId }: { currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("actorUserId", currentUserId);
    if (name) form.set("name", name);
    const response = await fetch("/api/upload-resume", { method: "POST", body: form });
    if (!response.ok) return;
    window.location.reload();
  }

  return (
    <details className="inlineForm" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Upload resume</summary>
      <form onSubmit={submit}>
        <input value={name} onChange={(event) => setName(event.target.value)} name="name" placeholder="Candidate name" />
        <input name="resume" type="file" accept="application/pdf" required />
        <button type="submit">Add candidate</button>
      </form>
    </details>
  );
}

function CandidateHero({
  candidate,
  workflow,
  users,
  onStatus,
  onOwner,
  onQuickStatus,
  onPrevious,
  onNext
}: {
  candidate: Candidate;
  workflow: CandidateWorkflow;
  users: User[];
  onStatus: (status: CandidateWorkflow["status"]) => void;
  onOwner: (owner: string) => void;
  onQuickStatus: (status: CandidateWorkflow["status"]) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const action = actionFor(candidate);
  return (
    <header className="candidateHero">
      <div className="heroMain">
        <div className="titleLine">
          <span className="rankBadge">#{candidate.rank}</span>
          <h2>{candidate.name}</h2>
          <span className={`actionPill ${action}`}>{actionLabel(action)}</span>
        </div>
        <p>
          {candidate.years ? `${candidate.years}+ years mentioned` : "Years unclear"} · {candidate.pages ?? "?"} pages · {candidate.file}
        </p>
        <div className="heroActions">
          <button onClick={() => onQuickStatus("round1")}>Move to Round 1</button>
          <button onClick={() => onQuickStatus("hold")}>Hold</button>
          <button onClick={() => onQuickStatus("no_hire")}>No hire</button>
        </div>
      </div>
      <div className="heroScore">
        <span>Strict score</span>
        <strong>{candidate.stage0.score}/20</strong>
        <small>
          Advance {candidate.stage0.pass_bar}+ · Plan bar {candidate.stage0.hiring_plan_pass_bar ?? 14}+
        </small>
      </div>
      <div className="heroControls">
        <div className="navButtons">
          <button onClick={onPrevious} disabled={!onPrevious} title="Previous candidate">
            <ArrowLeft size={16} />
          </button>
          <button onClick={onNext} disabled={!onNext} title="Next candidate">
            <ArrowRight size={16} />
          </button>
        </div>
        <label>
          <span>Status</span>
          <select value={workflow.status} onChange={(event) => onStatus(event.target.value as CandidateWorkflow["status"])}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Owner</span>
          <select value={workflow.ownerUserId} onChange={(event) => onOwner(event.target.value)}>
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Overview({
  candidate,
  data,
  workflow,
  onNotes,
  onSaveNotes
}: {
  candidate: Candidate;
  data: EvaluationData;
  workflow: CandidateWorkflow;
  onNotes: (notes: string) => void;
  onSaveNotes: (notes: string) => void;
}) {
  return (
    <div className="overviewGrid">
      <section className="primaryStack">
        <ActionBanner candidate={candidate} />
        <ScoreBreakdown candidate={candidate} data={data} />
        <EvidenceDeck candidate={candidate} />
      </section>
      <aside className="inspector">
        <Snapshot candidate={candidate} />
        <div className="panel">
          <h3>Review Notes</h3>
          <textarea
            value={workflow.notes}
            onChange={(event) => onNotes(event.target.value)}
            placeholder="Manual checks, doubts, interview follow-ups, or references to verify."
          />
          <button className="saveButton" onClick={() => onSaveNotes(workflow.notes)}>
            Save note
          </button>
        </div>
      </aside>
    </div>
  );
}

function ActionBanner({ candidate }: { candidate: Candidate }) {
  const action = actionFor(candidate);
  const icon = action === "advance" ? <CheckCircle2 size={18} /> : action === "reject" ? <XCircle size={18} /> : <AlertTriangle size={18} />;
  return (
    <section className={`actionBanner ${action}`}>
      <div>
        {icon}
        <div>
          <h3>{actionLabel(action)}</h3>
          <p>
            Resume-only strict screen. Use this to decide interview queue priority, then verify with Round 1-3 evidence.
          </p>
        </div>
      </div>
      {candidate.stage0.gaps_or_review_notes.length > 0 && <span>{candidate.stage0.gaps_or_review_notes.join("; ")}</span>}
    </section>
  );
}

function ScoreBreakdown({ candidate, data }: { candidate: Candidate; data: EvaluationData }) {
  return (
    <section className="panel">
      <div className="sectionHeading">
        <div>
          <h3>Stage 0 Evidence Score</h3>
          <p>High-strictness interpretation of the hiring plan resume screen.</p>
        </div>
        <strong>{candidate.stage0.score}/20</strong>
      </div>
      <div className="metricRows">
        {metricOrder.map((metricId) => {
          const area = data.resume_screen_rubric.find((item) => item.id === metricId);
          const metric = candidate.stage0.metrics[metricId];
          if (!area || !metric) return null;
          return (
            <details key={metricId} className="metricRow" open={metric.score > 0}>
              <summary>
                <span>{area.label}</span>
                <span className="miniBar" aria-hidden="true">
                  <i style={{ width: `${Math.round((metric.score / area.max) * 100)}%` }} />
                </span>
                <strong>
                  {metric.score}/{area.max}
                </strong>
              </summary>
              <p>{area.strong_evidence}</p>
              {metric.evidence.length > 0 ? (
                <ul>
                  {metric.evidence.slice(0, 4).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No strong resume text evidence found.</p>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}

function EvidenceDeck({ candidate }: { candidate: Candidate }) {
  return (
    <section className="evidenceDeck">
      <TextBlock title="Summary/Profile" value={candidate.summary_excerpt} defaultOpen />
      <TextBlock title="Experience Evidence" value={candidate.experience_excerpt} defaultOpen />
      <TextBlock title="Project Evidence" value={candidate.project_excerpt} />
    </section>
  );
}

function Snapshot({ candidate }: { candidate: Candidate }) {
  const resumeUrl = `/api/resume/${encodeURIComponent(candidate.file)}`;
  return (
    <div className="panel snapshot">
      <div className="sectionHeading">
        <div>
          <h3>Candidate Snapshot</h3>
          <p>{candidate.file}</p>
        </div>
        <a href={resumeUrl} target="_blank" rel="noreferrer" title="Open resume PDF">
          <ExternalLink size={16} />
        </a>
      </div>
      <dl className="infoList">
        <div>
          <dt>Email</dt>
          <dd>{candidate.contacts.emails.join(", ") || "Not found"}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{candidate.contacts.phones.join(", ") || "Not found"}</dd>
        </div>
        <div>
          <dt>Links</dt>
          <dd>{candidate.contacts.links.join(", ") || "Not found"}</dd>
        </div>
      </dl>
      <h4>Recent Role Lines</h4>
      <ul className="compactList">
        {candidate.recent_titles.slice(0, 5).map((title) => (
          <li key={title}>{title}</li>
        ))}
      </ul>
      <h4>Tech Footprint</h4>
      <div className="chips">
        {skillsFor(candidate).map((chip) => (
          <span key={chip}>{chip}</span>
        ))}
      </div>
    </div>
  );
}

function TextBlock({ title, value, defaultOpen = false }: { title: string; value: string; defaultOpen?: boolean }) {
  if (!value) return null;
  return (
    <details className="textBlock" open={defaultOpen}>
      <summary>{title}</summary>
      <pre>{value}</pre>
    </details>
  );
}

function Scorecards({
  candidate,
  data,
  workflow,
  onScore,
  onNote
}: {
  candidate: Candidate;
  data: EvaluationData;
  workflow: CandidateWorkflow;
  onScore: (roundId: string, areaId: string, score: number) => void;
  onNote: (roundId: string, note: string) => void;
}) {
  const total = finalTotal(candidate, workflow);
  return (
    <div className="scorecardLayout">
      <div className="scoreSummary">
        <div>
          <span>Total entered score</span>
          <strong>{total}/170</strong>
        </div>
        <div>
          <span>Decision guide</span>
          <strong>{decisionGuide(total)}</strong>
        </div>
        <p>Hard rules still require Round 2 &gt;= 38/50, Round 3 &gt;= 30/40, security/privacy judgment, testing judgment, real ownership, and working-code evidence.</p>
      </div>
      <div className="roundStack">
        {Object.entries(data.round_scorecards)
          .filter(([roundId]) => roundId !== "stage0")
          .map(([roundId, round]) => (
            <RoundCard key={roundId} roundId={roundId} round={round} workflow={workflow} onScore={onScore} onNote={onNote} />
          ))}
      </div>
    </div>
  );
}

function RoundCard({
  roundId,
  round,
  workflow,
  onScore,
  onNote
}: {
  roundId: string;
  round: RoundScorecard;
  workflow: CandidateWorkflow;
  onScore: (roundId: string, areaId: string, score: number) => void;
  onNote: (roundId: string, note: string) => void;
}) {
  const total = roundTotal(workflow, roundId);
  const passed = total >= round.pass_bar;
  return (
    <section className="roundSection">
      <header>
        <div>
          <h3>{round.name}</h3>
          <p>
            Pass bar {round.pass_bar}/{round.points}
            {round.hard_rule ? ` · ${round.hard_rule}` : ""}
          </p>
        </div>
        <span className={passed ? "roundScore passed" : "roundScore"}>
          {total}/{round.points}
        </span>
      </header>
      {round.questions && (
        <details className="questionBank">
          <summary>Core questions</summary>
          <ol>
            {round.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ol>
        </details>
      )}
      <div className="roundAreas">
        {(round.areas ?? []).map(([areaId, label, max]) => {
          const value = workflow.roundScores[roundId]?.[areaId] ?? 0;
          return (
            <label key={areaId} className="roundArea">
              <span>
                {label}
                <small>/{max}</small>
              </span>
              <input
                type="number"
                min={0}
                max={max}
                value={value}
                onChange={(event) => onScore(roundId, areaId, Math.max(0, Math.min(max, Number(event.target.value))))}
              />
            </label>
          );
        })}
      </div>
      <textarea
        value={workflow.roundNotes[roundId] ?? ""}
        onChange={(event) => onNote(roundId, event.target.value)}
        placeholder={`Evidence notes for ${round.name}`}
      />
    </section>
  );
}

function PdfView({ candidate }: { candidate: Candidate }) {
  const url = `/api/resume/${encodeURIComponent(candidate.file)}`;
  return (
    <section className="pdfPanel">
      <header>
        <div>
          <h3>Resume PDF</h3>
          <p>{candidate.source_path}</p>
        </div>
        <a href={url} target="_blank" rel="noreferrer">
          <FileText size={16} />
          Open in tab
        </a>
      </header>
      <iframe title={`${candidate.name} resume`} src={url} />
    </section>
  );
}

function ProcessGuide({ data, candidate, workflow }: { data: EvaluationData; candidate: Candidate; workflow: CandidateWorkflow }) {
  const stages = Object.entries(data.round_scorecards);
  const total = finalTotal(candidate, workflow);
  return (
    <div className="process">
      <section className="scoreSummary">
        <div>
          <span>Candidate</span>
          <strong>{candidate.name}</strong>
        </div>
        <div>
          <span>Current status</span>
          <strong>{statusLabels[workflow.status]}</strong>
        </div>
        <div>
          <span>Total score</span>
          <strong>{total}/170</strong>
        </div>
      </section>
      <section className="processColumns">
        {stages.map(([id, stage]) => {
          const score = id === "stage0" ? candidate.stage0.score : roundTotal(workflow, id);
          const passed = score >= stage.pass_bar;
          return (
            <article key={id} className="processStep">
              <header>
                {passed ? <CheckCircle2 size={18} /> : score > 0 ? <AlertTriangle size={18} /> : <XCircle size={18} />}
                <h3>{stage.name}</h3>
              </header>
              <p>
                {score}/{stage.points} · pass bar {stage.pass_bar}
              </p>
              {stage.hard_rule && <p className="muted">{stage.hard_rule}</p>}
            </article>
          );
        })}
      </section>
      <section className="panel">
        <h3>Final Decision Model</h3>
        <div className="decisionGrid">
          <span>145-170</span>
          <strong>Strong hire</strong>
          <span>128-144</span>
          <strong>Hire</strong>
          <span>115-127</span>
          <strong>Lean hire if gaps are minor and references are strong</strong>
          <span>98-114</span>
          <strong>Lean no-hire</strong>
          <span>Below 98</span>
          <strong>No-hire</strong>
        </div>
      </section>
      <section className="panel">
        <h3>Reference Check Questions</h3>
        <ol>
          <li>What did this person own technically?</li>
          <li>Were they hands-on?</li>
          <li>Could they debug production issues?</li>
          <li>Did they write or review meaningful automated tests?</li>
          <li>Did they review code effectively?</li>
          <li>Did they mentor others?</li>
          <li>How did they handle ambiguous requirements?</li>
          <li>How did they behave under release pressure?</li>
          <li>Would you hire them again?</li>
          <li>Where would they need support?</li>
        </ol>
      </section>
    </div>
  );
}
