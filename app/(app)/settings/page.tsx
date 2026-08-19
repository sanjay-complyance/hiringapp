import { Bot, KeyRound, LockKeyhole, Network, ShieldAlert, UsersRound } from "lucide-react";
import { PageHeader } from "@/app/components/page-header";
import { MemberForm, MemberRoleAction, OrganizationSettings, ProviderForm, RemoveProvider } from "@/app/components/settings-actions";
import { hasPermission, requirePageContext } from "@/lib/ats/authz";
import { getSettingsData } from "@/lib/ats/data";
import { formatDateTime, titleCase } from "@/lib/ats/format";

export default async function SettingsPage() {
  const context = await requirePageContext();
  const data = await getSettingsData(context.organization.id);
  const canManageUsers = hasPermission(context.role, "users:manage");
  const canManageProviders = hasPermission(context.role, "providers:manage");

  return <>
    <PageHeader eyebrow="Organization controls" title="Settings" description={context.organization.name} actions={canManageUsers ? <MemberForm /> : null} />
    <div className="settings-layout">
      <section className="content-section span-all">
        <div className="section-heading"><div><p className="eyebrow">Security status</p><h2><LockKeyhole size={18} />Internal beta access</h2></div><span className="badge warning"><ShieldAlert size={13} />Identity not verified</span></div>
        <div className="security-banner"><ShieldAlert size={20} /><div><strong>Email allowlist login is active</strong><p>Anyone who knows an active member email can impersonate that member. Candidate data and connected AI usage are not production-safe until verified login is enabled.</p></div></div>
      </section>

      <section className="content-section span-all">
        <div className="section-heading"><div><p className="eyebrow">Team</p><h2><UsersRound size={18} />Members and permissions</h2></div>{canManageUsers ? <MemberForm /> : null}</div>
        <div className="member-list">{data.members.map((member) => <div className="member-row" key={member.id}><div className="table-avatar">{member.name.slice(0, 1).toUpperCase()}</div><div><strong>{member.name}</strong><span>{member.email}</span></div><span className={`badge ${member.active ? "active" : "archived"}`}>{member.active ? "Active" : "Inactive"}</span>{canManageUsers ? <MemberRoleAction id={member.id} role={member.role} active={member.active} /> : <span>{titleCase(member.role)}</span>}</div>)}</div>
      </section>

      <section className="content-section">
        <div className="section-heading"><div><p className="eyebrow">AI connections</p><h2><Bot size={18} />Recruiting copilot</h2></div></div>
        <div className="provider-list">{(["openai", "anthropic"] as const).map((provider) => {
          const connection = data.providers.find((item) => item.provider === provider);
          return <article key={provider}><div className="provider-logo"><KeyRound size={18} /></div><div><strong>{provider === "openai" ? "OpenAI" : "Claude"}</strong>{connection ? <span>{connection.model}{canManageProviders ? ` · key ••••${connection.key_last_four}` : " · Connected"}</span> : <span>Not connected</span>}{connection?.last_tested_at ? <small>Tested {formatDateTime(connection.last_tested_at)}</small> : null}</div>{connection && canManageProviders ? <RemoveProvider provider={provider} /> : canManageProviders ? <ProviderForm provider={provider} /> : null}</article>;
        })}</div>
        <div className="usage-meter"><div><span>Monthly usage</span><strong>{Number(data.usage.tokens).toLocaleString("en-IN")} / {context.organization.ai_monthly_token_limit.toLocaleString("en-IN")} tokens</strong></div><i><b style={{ width: `${Math.min(100, Number(data.usage.tokens) / Math.max(context.organization.ai_monthly_token_limit, 1) * 100)}%` }} /></i></div>
      </section>

      <section className="content-section">
        <div className="section-heading"><div><p className="eyebrow">Organization</p><h2>Data and usage policy</h2></div></div>
        {hasPermission(context.role, "org:manage") ? <OrganizationSettings retentionDays={context.organization.retention_days} tokenLimit={context.organization.ai_monthly_token_limit} /> : <dl className="detail-list"><div><dt>Retention</dt><dd>{context.organization.retention_days ? `${context.organization.retention_days} days` : "Not configured"}</dd></div><div><dt>AI limit</dt><dd>{context.organization.ai_monthly_token_limit.toLocaleString("en-IN")} tokens</dd></div></dl>}
      </section>

      <section className="content-section span-all">
        <div className="section-heading"><div><p className="eyebrow">Workflow library</p><h2><Network size={18} />Pipeline templates</h2></div></div>
        <div className="template-list">{data.templates.map((template) => <article key={template.id}><div><strong>{template.name}</strong><p>{template.description}</p></div><span>{template.stages} stages</span>{template.is_default ? <span className="badge active">Default</span> : null}</article>)}</div>
      </section>
    </div>
  </>;
}
