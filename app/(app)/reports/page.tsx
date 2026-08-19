import { Clock3, Gauge, Target, TrendingUp } from "lucide-react";
import { PageHeader } from "@/app/components/page-header";
import { requirePageContext } from "@/lib/ats/authz";
import { getReports } from "@/lib/ats/data";
import { formatDate, titleCase } from "@/lib/ats/format";

export default async function ReportsPage() {
  const context = await requirePageContext("reports:read");
  const data = await getReports(context.organization.id);
  const maxFunnel = Math.max(...data.funnel.map((item) => item.count), 1);
  const maxSource = Math.max(...data.sources.map((item) => item.applications), 1);

  return <>
    <PageHeader eyebrow="Hiring intelligence" title="Reports" description="Funnel health, velocity, sources, and workload" />
    <section className="metric-grid report-metrics">
      <article className="metric-card blue"><div><span>Decisions completed</span><strong>{data.velocity.completed_decisions}</strong></div><Target size={20} /></article>
      <article className="metric-card amber"><div><span>Time to first review</span><strong>{data.velocity.avg_hours_to_review || "-"}<small> hrs</small></strong></div><Gauge size={20} /></article>
      <article className="metric-card neutral"><div><span>Time to decision</span><strong>{data.velocity.avg_days_to_decision || "-"}<small> days</small></strong></div><Clock3 size={20} /></article>
      <article className="metric-card green"><div><span>Time to hire</span><strong>{data.velocity.avg_days_to_hire || "-"}<small> days</small></strong></div><Clock3 size={20} /></article>
      <article className="metric-card blue"><div><span>Offer acceptance</span><strong>{data.velocity.offer_acceptance || "-"}<small>%</small></strong></div><TrendingUp size={20} /></article>
    </section>

    <div className="reports-grid">
      <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Outcomes</p><h2>Application funnel</h2></div></div><div className="bar-chart">{data.funnel.map((item) => <div key={item.state}><div><span>{titleCase(item.state)}</span><strong>{item.count}</strong></div><i><b style={{ width: `${Math.max(5, item.count / maxFunnel * 100)}%` }} /></i></div>)}</div></section>
      <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Acquisition</p><h2>Source quality</h2></div></div><div className="bar-chart source-chart">{data.sources.map((item) => <div key={item.source}><div><span>{item.source}</span><strong>{item.applications} · {item.hired} hired</strong></div><i><b style={{ width: `${Math.max(5, item.applications / maxSource * 100)}%` }} /></i></div>)}</div></section>
      <section className="content-section span-all"><div className="section-heading"><div><p className="eyebrow">Hiring plan</p><h2>Requisition progress</h2></div></div><div className="plan-progress-list">{data.plans.map((plan) => { const progress = Math.min(100, plan.hired / Math.max(plan.openings, 1) * 100); return <article key={plan.id}><div><strong>{plan.title}</strong><span>{titleCase(plan.state)} · target {formatDate(plan.target_date)}</span></div><div><strong>{plan.hired}/{plan.openings} hired</strong><span>{plan.active} active</span></div><i><b style={{ width: `${progress}%` }} /></i></article>; })}</div></section>
      <section className="content-section span-all"><div className="section-heading"><div><p className="eyebrow">Operations</p><h2>Stage aging</h2></div></div><div className="table-wrap"><table><thead><tr><th>Stage</th><th>Candidates</th><th>Average age</th><th>Overdue</th></tr></thead><tbody>{data.stages.map((stage) => <tr key={stage.stage}><td>{stage.stage}</td><td>{stage.count}</td><td>{stage.avg_days || "0"} days</td><td><span className={stage.overdue ? "overdue-text" : ""}>{stage.overdue}</span></td></tr>)}</tbody></table></div></section>
      <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Capacity</p><h2>Team workload</h2></div></div><div className="workload-list">{data.workload.map((person) => <div key={person.name}><span>{person.name}</span><strong>{person.applications} candidates</strong><em>{person.open_tasks} tasks</em></div>)}</div></section>
      <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Decision audit</p><h2>Rejection reasons</h2></div></div><div className="reason-list">{data.reasons.map((reason) => <div key={reason.reason}><span>{reason.reason}</span><strong>{reason.count}</strong></div>)}</div></section>
    </div>
  </>;
}
