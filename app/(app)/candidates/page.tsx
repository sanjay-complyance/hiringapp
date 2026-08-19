import { CandidateDirectory, ResumeUpload } from "@/app/components/candidate-actions";
import { PageHeader } from "@/app/components/page-header";
import { hasPermission, requirePageContext } from "@/lib/ats/authz";
import { getCandidates, getJobs } from "@/lib/ats/data";

export default async function CandidatesPage() {
  const context = await requirePageContext("candidates:read");
  const [candidates, jobs] = await Promise.all([
    getCandidates(context.organization.id, hasPermission(context.role, "candidates:pii")),
    getJobs(context.organization.id)
  ]);
  return <><PageHeader eyebrow="Talent database" title="Candidates" description={`${candidates.filter((item) => !item.archived_at).length} active records`} actions={hasPermission(context.role, "candidates:manage") ? <ResumeUpload jobs={jobs.filter((job) => ["open", "draft"].includes(job.state)).map((job) => ({ id: job.id, title: job.title }))} /> : null} /><CandidateDirectory candidates={candidates} piiVisible={hasPermission(context.role, "candidates:pii")} /></>;
}
