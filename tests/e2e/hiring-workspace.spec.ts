import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";

const organizationId = "00000000-0000-0000-0000-000000000001";
const templateId = "10000000-0000-0000-0000-000000000001";

async function databaseUrl() {
  const env = await readFile(".env.local", "utf8");
  return env.split(/\r?\n/).find((line) => line.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length) || "";
}

async function cleanupTask(taskId: string) {
  const pool = new Pool({ connectionString: await databaseUrl(), ssl: { rejectUnauthorized: true }, max: 1 });
  await pool.query("delete from domain_events where aggregate_type='task' and aggregate_id=$1", [taskId]);
  await pool.query("delete from hiring_tasks where id=$1", [taskId]);
  await pool.end();
}

async function withDatabase<T>(operation: (pool: Pool) => Promise<T>) {
  const pool = new Pool({ connectionString: await databaseUrl(), ssl: { rejectUnauthorized: true }, max: 1 });
  try {
    return await operation(pool);
  } finally {
    await pool.end();
  }
}

async function cleanupJob(jobId: string, candidateIds: string[] = [], aggregateIds: string[] = []) {
  await withDatabase(async (pool) => {
    await pool.query("delete from domain_events where aggregate_id=any($1::text[])", [[jobId, ...aggregateIds]]);
    await pool.query("delete from jobs where id=$1", [jobId]);
    if (candidateIds.length) await pool.query("delete from candidates where id=any($1::text[])", [candidateIds]);
  });
}

async function createDraftJob(request: import("@playwright/test").APIRequestContext, title: string) {
  const response = await request.post("/api/jobs", { data: {
    title, code: `E2E-${Date.now()}`, department: "Engineering", businessReason: "End-to-end workflow verification requisition.",
    openings: 1, priority: "medium", employmentType: "full_time", location: "Chennai", workMode: "hybrid",
    compensationMin: 1000000, compensationMax: 2000000, compensationCurrency: "INR", templateId
  } });
  expect(response.status()).toBe(201);
  return (await response.json() as { job: { id: string; version: number } }).job;
}

async function createCandidateApplication(jobId: string, stageId: string, ownerId: string, label: string) {
  return withDatabase(async (pool) => {
    const candidateId = `e2e-${randomUUID()}`;
    await pool.query(
      `insert into candidates (id, organization_id, name, normalized_name, file_name, source_path, stage0, profile, status, owner_user_id, created_by)
       values ($1,$2,$3,$4,$5,$6,'{}'::jsonb,$7::jsonb,'new',$8,$8)`,
      [candidateId, organizationId, label, label.toLowerCase().replace(/[^a-z0-9]/g, ""), `${candidateId}.pdf`,
        `e2e:${candidateId}`, JSON.stringify({ years: 5, contacts: { emails: [`${candidateId}@example.test`] } }), ownerId]
    );
    const application = await pool.query<{ id: string; version: number }>(
      `insert into applications (organization_id, candidate_id, job_id, current_stage_id, source, owner_user_id, created_by)
       values ($1,$2,$3,$4,'e2e',$5,$5) returning id, version`,
      [organizationId, candidateId, jobId, stageId, ownerId]
    );
    return { candidateId, applicationId: application.rows[0].id, version: application.rows[0].version };
  });
}

async function login(page: import("@playwright/test").Page, email = "sanjay@complyance.io") {
  await page.goto("/");
  await page.getByTestId("login-email").fill(email);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("protects organization data until an allowlisted session exists", async ({ page, request }) => {
  const response = await request.get("/api/events?latest=1");
  expect(response.status()).toBe(401);
  await page.goto("/candidates");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("login-email")).toBeVisible();
});

test("renders the route-based ATS and migrated candidate pipeline", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Candidates" }).click();
  await expect(page.getByTestId("candidate-row")).toHaveCount(79);
  await page.getByRole("link", { name: "Jobs" }).click();
  await page.getByRole("link", { name: "Senior Software Developer" }).first().click();
  await expect(page.locator(".stage-list").getByText("HR phone screen", { exact: true })).toBeVisible();
  await expect(page.locator(".stage-list").getByText("Technical + decision call", { exact: true })).toBeVisible();
  await expect(page.locator(".stage-list").getByText("Final panel", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(79);
});

test("opens a complete candidate record with resume evidence", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Candidates" }).click();
  await page.getByTestId("candidate-row").first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Application details" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence and eligibility" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resumes" })).toBeVisible();
  await expect(page.locator(".resume-preview")).toBeVisible();
  const candidateName = (await page.locator("h1").textContent()) || "";
  await page.getByRole("button", { name: "Log communication" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Template").selectOption({ label: "Interview invitation" });
  await expect(dialog.getByLabel("Subject")).toHaveValue("Interview details");
  expect(await dialog.getByLabel("Notes").inputValue()).toContain(candidateName);
});

test("detects a duplicate resume without creating a new record", async ({ request }) => {
  const loginResponse = await request.post("/api/session", { data: { email: "sanjay@complyance.io" } });
  expect(loginResponse.ok()).toBeTruthy();
  const pool = new Pool({ connectionString: await databaseUrl(), ssl: { rejectUnauthorized: true }, max: 1 });
  const document = await pool.query<{ bytes: Buffer; file_name: string }>(
    "select bytes, original_file_name as file_name from resume_files where organization_id is not null order by created_at limit 1"
  );
  await pool.end();
  const response = await request.post("/api/candidates/upload", {
    multipart: {
      jobId: "20000000-0000-0000-0000-000000000001",
      source: "e2e",
      resume: { name: document.rows[0].file_name, mimeType: "application/pdf", buffer: document.rows[0].bytes }
    }
  });
  expect(response.status()).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ code: "DUPLICATE_CANDIDATE" });
});

test("enforces viewer PII and action boundaries", async ({ page }) => {
  const email = `viewer-${Date.now()}@example.test`;
  const fixture = await withDatabase(async (pool) => {
    const user = await pool.query<{ id: string }>(
      "insert into app_users (email,name,role) values ($1,'E2E Viewer','Viewer') returning id", [email]
    );
    await pool.query(
      "insert into organization_memberships (organization_id,user_id,role) values ($1,$2,'viewer')",
      [organizationId, user.rows[0].id]
    );
    const document = await pool.query<{ id: string }>(
      "select id::text from resume_files where organization_id=$1 order by created_at limit 1", [organizationId]
    );
    return { userId: user.rows[0].id, documentId: document.rows[0].id };
  });
  try {
    await login(page, email);
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Tasks" })).toHaveCount(0);
    await page.getByRole("link", { name: "Candidates" }).click();
    await expect(page.getByRole("button", { name: "Upload resume" })).toHaveCount(0);
    await expect(page.getByText("Contact restricted").first()).toBeVisible();
    await page.getByTestId("candidate-row").first().getByRole("link").click();
    await expect(page.getByText("Contact details restricted")).toBeVisible();
    await expect(page.locator(".resume-preview")).toHaveCount(0);
    const documentResponse = await page.request.get(`/api/documents/${fixture.documentId}`);
    expect(documentResponse.status()).toBe(403);
  } finally {
    await withDatabase(async (pool) => {
      await pool.query("delete from organization_memberships where organization_id=$1 and user_id=$2", [organizationId, fixture.userId]);
      await pool.query("delete from app_users where id=$1", [fixture.userId]);
    });
  }
});

test("archives and permanently deletes a candidate while retaining the audit event", async ({ request }) => {
  await request.post("/api/session", { data: { email: "sanjay@complyance.io" } });
  const fixture = await withDatabase(async (pool) => {
    const owner = await pool.query<{ id: string }>("select id from app_users where lower(email)='sanjay@complyance.io'");
    const stage = await pool.query<{ id: string }>(
      "select id from job_stages where job_id='20000000-0000-0000-0000-000000000001' order by position limit 1"
    );
    return createCandidateApplication("20000000-0000-0000-0000-000000000001", stage.rows[0].id, owner.rows[0].id, "E2E Deletion Candidate");
  });
  try {
    const archived = await request.post(`/api/candidates/${fixture.candidateId}/record`, { data: {
      action: "archive", expectedVersion: 1, reason: "E2E retention workflow verification"
    } });
    expect(archived.ok()).toBeTruthy();
    const archivedVersion = (await archived.json() as { version: number }).version;
    const deleted = await request.post(`/api/candidates/${fixture.candidateId}/record`, { data: {
      action: "delete", expectedVersion: archivedVersion, reason: "E2E approved deletion verification"
    } });
    expect(deleted.ok()).toBeTruthy();
    const state = await withDatabase(async (pool) => pool.query<{ candidates: number; applications: number; events: number }>(
      `select (select count(*)::int from candidates where id=$1) as candidates,
        (select count(*)::int from applications where id=$2) as applications,
        (select count(*)::int from domain_events where aggregate_id=$1 and event_type='candidate.deleted') as events`,
      [fixture.candidateId, fixture.applicationId]
    ));
    expect(state.rows[0]).toEqual({ candidates: 0, applications: 0, events: 1 });
  } finally {
    await withDatabase(async (pool) => {
      await pool.query("delete from domain_events where aggregate_id=any($1::text[])", [[fixture.candidateId, fixture.applicationId]]);
      await pool.query("delete from candidates where id=$1", [fixture.candidateId]);
    });
  }
});

test("versions requisition, pipeline, rubric, and founder approval changes", async ({ page, request }) => {
  await request.post("/api/session", { data: { email: "sanjay@complyance.io" } });
  const job = await createDraftJob(request, `E2E configurable role ${Date.now()}`);
  try {
    const edited = await request.patch(`/api/jobs/${job.id}`, { data: {
      expectedVersion: job.version, location: "Bengaluru", workMode: "remote"
    } });
    expect(edited.ok()).toBeTruthy();
    const editVersion = (await edited.json() as { version: number }).version;
    const stage = await withDatabase(async (pool) => (await pool.query<{ id: string }>(
      "select id from job_stages where job_id=$1 and stage_key='hr_screen'", [job.id]
    )).rows[0]);
    const stageUpdate = await request.patch(`/api/jobs/${job.id}/stages/${stage.id}`, { data: {
      expectedJobVersion: editVersion, name: "Structured HR screen", kind: "phone_screen", slaHours: 48,
      requiredScorecards: 1, competencies: ["Role motivation", "Availability", "Compensation alignment"]
    } });
    expect(stageUpdate.ok()).toBeTruthy();
    const stageVersion = (await stageUpdate.json() as { jobVersion: number }).jobVersion;
    const rubricUpdate = await request.post(`/api/jobs/${job.id}/rubric`, { data: {
      expectedJobVersion: stageVersion, name: "E2E evidence rubric",
      criteria: [{ id: "delivery", label: "Delivery evidence", max: 5, hard: false }]
    } });
    expect(rubricUpdate.status()).toBe(201);
    const rubricVersion = (await rubricUpdate.json() as { jobVersion: number }).jobVersion;
    const submitted = await request.post(`/api/jobs/${job.id}/state`, { data: { action: "submit", expectedVersion: rubricVersion } });
    expect(submitted.ok()).toBeTruthy();
    const submittedVersion = (await submitted.json() as { version: number }).version;
    await request.post("/api/session", { data: { email: "meiyappanmm@complyance.io" } });
    const approved = await request.post(`/api/jobs/${job.id}/state`, { data: { action: "approve", expectedVersion: submittedVersion } });
    expect(approved.ok()).toBeTruthy();

    await login(page);
    await page.goto(`/jobs/${job.id}`);
    await expect(page.getByText("Structured HR screen", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E evidence rubric" })).toBeVisible();
    await expect(page.getByText("Bengaluru · Remote")).toBeVisible();
    await expect(page.getByText("Open", { exact: true }).first()).toBeVisible();
  } finally {
    await cleanupJob(job.id);
  }
});

test("enforces three rounds, locked scorecards, final offer approval, hiring, and rejection evidence", async ({ request }) => {
  await request.post("/api/session", { data: { email: "sanjay@complyance.io" } });
  const job = await createDraftJob(request, `E2E three-round role ${Date.now()}`);
  const candidateIds: string[] = [];
  const aggregateIds: string[] = [];
  try {
    const submitted = await request.post(`/api/jobs/${job.id}/state`, { data: { action: "submit", expectedVersion: job.version } });
    const submittedVersion = (await submitted.json() as { version: number }).version;
    await request.post("/api/session", { data: { email: "meiyappanmm@complyance.io" } });
    const approved = await request.post(`/api/jobs/${job.id}/state`, { data: { action: "approve", expectedVersion: submittedVersion } });
    expect(approved.ok()).toBeTruthy();

    const fixture = await withDatabase(async (pool) => {
      const users = await pool.query<{ id: string; email: string }>(
        "select id,email from app_users where lower(email)=any($1::text[])",
        [["sanjay@complyance.io", "arul@complyance.io"]]
      );
      const stages = await pool.query<{ id: string; stage_key: string }>(
        "select id,stage_key from job_stages where job_id=$1 order by position", [job.id]
      );
      return {
        users: Object.fromEntries(users.rows.map((item) => [item.email.toLowerCase(), item.id])),
        stages: Object.fromEntries(stages.rows.map((item) => [item.stage_key, item.id]))
      };
    });
    const ownerId = fixture.users["sanjay@complyance.io"];
    const arulId = fixture.users["arul@complyance.io"];
    const application = await createCandidateApplication(job.id, fixture.stages.hr_screen, ownerId, "E2E Round Candidate");
    candidateIds.push(application.candidateId);
    aggregateIds.push(application.applicationId);

    const missingFields = await request.post(`/api/applications/${application.applicationId}/transition`, { data: {
      action: "move", targetStageId: fixture.stages.technical_decision, expectedVersion: application.version
    } });
    expect(missingFields.status()).toBe(409);
    await expect(missingFields.json()).resolves.toMatchObject({ code: "REQUIRED_FIELDS_MISSING" });

    await request.post("/api/session", { data: { email: "arul@complyance.io" } });
    const screened = await request.patch(`/api/applications/${application.applicationId}`, { data: {
      expectedVersion: application.version, source: "e2e", consentStatus: "recorded", availabilityDate: "2026-10-01",
      noticePeriodDays: 30, workModePreference: "hybrid", expectedCompensation: 1800000,
      compensationCurrency: "INR", screeningSuitability: "strong", roleInterest: "high", locationConfirmed: true
    } });
    expect(screened.ok()).toBeTruthy();
    const screenedVersion = (await screened.json() as { version: number }).version;
    const missingFeedback = await request.post(`/api/applications/${application.applicationId}/transition`, { data: {
      action: "move", targetStageId: fixture.stages.technical_decision, expectedVersion: screenedVersion
    } });
    expect(missingFeedback.status()).toBe(409);
    await expect(missingFeedback.json()).resolves.toMatchObject({ code: "STAGE_GATE_BLOCKED" });

    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const hrInterview = await request.post(`/api/applications/${application.applicationId}/interviews`, { data: {
      stageId: fixture.stages.hr_screen, title: "E2E HR screen", kind: "phone", startsAt,
      participantUserIds: [arulId], competencyAssignments: [{ competency: "Role motivation", userId: arulId }]
    } });
    expect(hrInterview.status()).toBe(201);
    const hrInterviewId = (await hrInterview.json() as { id: string }).id;
    aggregateIds.push(hrInterviewId);
    const hrScorePayload = {
      scores: { "Role motivation": 4 }, overallScore: 4, recommendation: "hire",
      evidence: "Candidate confirmed strong role interest and practical availability.", risks: "", dissent: "", submit: true
    };
    const hrScore = await request.put(`/api/interviews/${hrInterviewId}/scorecard`, { data: hrScorePayload });
    expect(hrScore.ok()).toBeTruthy();
    const locked = await request.put(`/api/interviews/${hrInterviewId}/scorecard`, { data: hrScorePayload });
    expect(locked.status()).toBe(409);
    await expect(locked.json()).resolves.toMatchObject({ code: "SCORECARD_LOCKED" });

    const technicalMove = await request.post(`/api/applications/${application.applicationId}/transition`, { data: {
      action: "move", targetStageId: fixture.stages.technical_decision, expectedVersion: screenedVersion,
      evidence: "HR screen complete"
    } });
    expect(technicalMove.ok()).toBeTruthy();
    const technicalVersion = (await technicalMove.json() as { version: number }).version;

    await request.post("/api/session", { data: { email: "sanjay@complyance.io" } });
    const technicalInterview = await request.post(`/api/applications/${application.applicationId}/interviews`, { data: {
      stageId: fixture.stages.technical_decision, title: "E2E technical round", kind: "video", startsAt,
      participantUserIds: [ownerId], competencyAssignments: [{ competency: "Technical depth", userId: ownerId }]
    } });
    const technicalInterviewId = (await technicalInterview.json() as { id: string }).id;
    aggregateIds.push(technicalInterviewId);
    const technicalScore = await request.put(`/api/interviews/${technicalInterviewId}/scorecard`, { data: {
      scores: { "Technical depth": 4 }, overallScore: 4, recommendation: "hire",
      evidence: "Candidate supplied concrete architecture and delivery evidence.", risks: "Scale depth to verify", dissent: "", submit: true
    } });
    expect(technicalScore.ok()).toBeTruthy();
    const finalMove = await request.post(`/api/applications/${application.applicationId}/transition`, { data: {
      action: "move", targetStageId: fixture.stages.final_panel, expectedVersion: technicalVersion,
      evidence: "Technical scorecard complete"
    } });
    expect(finalMove.ok()).toBeTruthy();

    const finalInterview = await request.post(`/api/applications/${application.applicationId}/interviews`, { data: {
      stageId: fixture.stages.final_panel, title: "E2E founder final", kind: "video", startsAt,
      participantUserIds: [ownerId, arulId], competencyAssignments: [{ competency: "Ownership", userId: ownerId }]
    } });
    const finalInterviewId = (await finalInterview.json() as { id: string }).id;
    aggregateIds.push(finalInterviewId);
    const finalScore = await request.put(`/api/interviews/${finalInterviewId}/scorecard`, { data: {
      scores: { Ownership: 5 }, overallScore: 5, recommendation: "strong_hire",
      evidence: "Final panel found clear ownership evidence and acceptable operating risk.", risks: "", dissent: "", submit: true
    } });
    expect(finalScore.ok()).toBeTruthy();

    const offer = await request.post("/api/offers", { data: {
      applicationId: application.applicationId, compensation: 1800000, currency: "INR",
      proposedStartDate: "2026-10-15", conditions: "Reference check"
    } });
    expect(offer.status()).toBe(201);
    const offerRecord = await offer.json() as { id: string; version: number };
    aggregateIds.push(offerRecord.id);
    const offerSubmitted = await request.post(`/api/offers/${offerRecord.id}/state`, { data: { action: "submit", expectedVersion: offerRecord.version } });
    const offerSubmittedVersion = (await offerSubmitted.json() as { version: number }).version;
    await request.post("/api/session", { data: { email: "meiyappanmm@complyance.io" } });
    const offerApproved = await request.post(`/api/offers/${offerRecord.id}/state`, { data: { action: "approve", expectedVersion: offerSubmittedVersion } });
    const offerApprovedVersion = (await offerApproved.json() as { version: number }).version;
    const offerSent = await request.post(`/api/offers/${offerRecord.id}/state`, { data: { action: "send", expectedVersion: offerApprovedVersion } });
    const offerSentVersion = (await offerSent.json() as { version: number }).version;
    const offerAccepted = await request.post(`/api/offers/${offerRecord.id}/state`, { data: { action: "accept", expectedVersion: offerSentVersion } });
    expect(offerAccepted.ok()).toBeTruthy();

    const rejected = await createCandidateApplication(job.id, fixture.stages.resume_review, ownerId, "E2E Rejected Candidate");
    candidateIds.push(rejected.candidateId);
    aggregateIds.push(rejected.applicationId);
    const rejection = await request.post(`/api/applications/${rejected.applicationId}/transition`, { data: {
      action: "reject", expectedVersion: rejected.version, reason: "Insufficient role-specific evidence",
      evidence: "Resume and screening evidence did not establish the required delivery depth.", risks: "Delivery ownership"
    } });
    expect(rejection.ok()).toBeTruthy();

    const outcomes = await withDatabase(async (pool) => pool.query<{ state: string; debriefs: number }>(
      `select applications.state,
        (select count(*)::int from debriefs where debriefs.application_id=applications.id) as debriefs
       from applications where applications.id=any($1::uuid[]) order by applications.id`,
      [[application.applicationId, rejected.applicationId]]
    ));
    expect(outcomes.rows.map((item) => item.state).sort()).toEqual(["hired", "rejected"]);
    expect(outcomes.rows.every((item) => item.debriefs >= 1)).toBeTruthy();
  } finally {
    await cleanupJob(job.id, candidateIds, aggregateIds);
  }
});

test("syncs a meaningful task update across logged-in users without reload", async ({ browser, request }) => {
  const loginResponse = await request.post("/api/session", { data: { email: "sanjay@complyance.io" } });
  expect(loginResponse.ok()).toBeTruthy();
  const marker = `E2E cross-user task ${Date.now()}`;
  const createResponse = await request.post("/api/tasks", { data: { title: marker, description: "sync verification", priority: "medium" } });
  expect(createResponse.ok()).toBeTruthy();
  const created = await createResponse.json() as { id: string };
  try {
    const arulContext = await browser.newContext();
    const arul = await arulContext.newPage();
    await login(arul, "arul@complyance.io");
    await arul.goto("/tasks");
    await expect(arul.getByText(marker)).toBeVisible({ timeout: 10_000 });
    await arulContext.close();
  } finally {
    await cleanupTask(created.id);
  }
});

test("rejects stale writes instead of overwriting", async ({ request }) => {
  await request.post("/api/session", { data: { email: "sanjay@complyance.io" } });
  const marker = `E2E concurrency ${Date.now()}`;
  const createdResponse = await request.post("/api/tasks", { data: { title: marker, priority: "low" } });
  const created = await createdResponse.json() as { id: string };
  try {
    const stale = await request.patch(`/api/tasks/${created.id}`, { data: { expectedVersion: 99, status: "completed" } });
    expect(stale.status()).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: "STALE_VERSION" });
  } finally {
    await cleanupTask(created.id);
  }
});

test("uses natural page scrolling on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/candidates");
  await page.getByTestId("candidate-row").first().getByRole("link").click();
  const geometry = await page.evaluate(() => ({
    overflow: getComputedStyle(document.body).overflowY,
    scrollHeight: document.documentElement.scrollHeight,
    viewport: window.innerHeight
  }));
  expect(geometry.overflow).not.toBe("hidden");
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.viewport * 2);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
});
