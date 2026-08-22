import { expect, test } from "@playwright/test";

const topFitCandidateIds = [
  "1786279400772",
  "1786011793040",
  "1785927295066",
  "1786386096469",
  "1786371334158",
  "1785990602083",
  "1786278021416",
  "1786212137595",
  "1785934744571"
];

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/");
  await page.getByTestId("login-email").fill(email);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("candidate-row").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Logged in")).toBeVisible();
}

test("sync API requires a signed session", async ({ request }) => {
  const response = await request.get("/api/sync?since=0&includeData=1");
  expect(response.status()).toBe(401);
});

test("logs in and protects candidate data until authenticated", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("login-email")).toBeVisible();
  await expect(page.getByTestId("candidate-row")).toHaveCount(0);

  await login(page, "sanjay@complyance.io");
});

test("hydrates an authenticated reload without locale errors", async ({ page }) => {
  await login(page, "sanjay@complyance.io");
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Hydration failed")) hydrationErrors.push(message.text());
  });

  await page.reload();
  await expect(page.getByTestId("candidate-row").first()).toBeVisible({ timeout: 20_000 });
  expect(hydrationErrors).toEqual([]);
});

test("shows the confirmed final shortlist instead of resume-score buckets", async ({ page }) => {
  await login(page, "sanjay@complyance.io");

  const summary = page.getByLabel("Final shortlist summary");
  await expect(summary).toContainText("Top fit9");
  await expect(summary).toContainText("Not moved70");
  await expect(summary).toContainText("Pending0");

  const rows = page.getByTestId("candidate-row");
  await expect(rows).toHaveCount(79);
  const firstNineIds = await rows.evaluateAll((items) => items.slice(0, 9).map((item) => item.getAttribute("data-candidate-id")));
  expect(firstNineIds.slice().sort()).toEqual(topFitCandidateIds.slice().sort());
  await expect(rows.nth(8)).toContainText("Top fit");
  await expect(rows.nth(9)).toContainText("Not moved to next round");

  await page.getByRole("button", { name: /^Top fit\s*9$/ }).click();
  await expect(rows).toHaveCount(9);
  await page.getByRole("button", { name: /^Not moved\s*70$/ }).click();
  await expect(rows).toHaveCount(70);
});

test("blocks advancing candidates at or above 7 years", async ({ request }) => {
  const loginResponse = await request.post("/api/session", {
    data: { email: "sanjay@complyance.io" }
  });
  expect(loginResponse.ok()).toBeTruthy();

  const response = await request.post("/api/candidates/1786274138922/status", {
    data: { status: "round1" }
  });
  expect(response.status()).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "Only candidates under 7 years of experience can be advanced"
  });
});

test("allows an explicitly approved experience exception to continue", async ({ request }) => {
  const loginResponse = await request.post("/api/session", {
    data: { email: "sanjay@complyance.io" }
  });
  expect(loginResponse.ok()).toBeTruthy();

  const advanced = await request.post("/api/candidates/1786011793040/status", {
    data: { status: "round2", fromStatus: "round1" }
  });
  const restored = await request.post("/api/candidates/1786011793040/status", {
    data: { status: "round1", fromStatus: "round2" }
  });

  expect(advanced.ok()).toBeTruthy();
  expect(restored.ok()).toBeTruthy();
});

test("ranks eligible under-seven candidates ahead of over-experience resumes", async ({ request }) => {
  const loginResponse = await request.post("/api/session", {
    data: { email: "sanjay@complyance.io" }
  });
  expect(loginResponse.ok()).toBeTruthy();

  const response = await request.get("/api/sync?since=0&includeData=1");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const candidates = body.data.candidates as Array<{ rank: number; years: number | null; stage0: { score: number } }>;

  expect(candidates.slice(0, 10).every((candidate) => typeof candidate.years === "number" && candidate.years < 7)).toBeTruthy();
  expect(candidates.find((candidate) => candidate.years !== null && candidate.years >= 7)?.rank).toBeGreaterThan(50);
});

test("opens candidate tabs on mobile without sticky hero overlap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "sanjay@complyance.io");

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const scrollMetrics = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>(".candidateList");
    return {
      bodyOverflow: window.getComputedStyle(document.body).overflow,
      pageScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      queueScrollable: Boolean(list && list.scrollHeight > list.clientHeight)
    };
  });
  expect(scrollMetrics).toEqual({ bodyOverflow: "auto", pageScrollable: true, queueScrollable: true });

  await page.getByRole("button", { name: /PDF/ }).click();
  await expect(page.locator(".pdfPanel iframe")).toBeVisible();
});

test("shows the three-round hiring process without deprecated stages", async ({ page }) => {
  await login(page, "sanjay@complyance.io");

  await expect(page.getByTestId("status-select").locator("option")).toHaveText([
    "New",
    "HR phone screen",
    "Tech + decision call",
    "Final panel",
    "Hire",
    "Not moved",
    "Hold"
  ]);

  await page.getByRole("button", { name: /Process/ }).click();
  await expect(page.getByRole("heading", { name: "Round 1 HR phone screen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Round 2 technical and decision call" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Round 3 final panel" })).toBeVisible();
  await expect(page.getByText("Round 4")).toHaveCount(0);

  await page.getByRole("button", { name: /Rounds/ }).click();
  await expect(page.locator(".roundSection")).toHaveCount(3);
});

test("syncs status changes across two logged-in users", async ({ browser }) => {
  const sanjayContext = await browser.newContext();
  const arulContext = await browser.newContext();
  const sanjay = await sanjayContext.newPage();
  const arul = await arulContext.newPage();

  await login(sanjay, "sanjay@complyance.io");
  await login(arul, "arul@complyance.io");

  const firstCandidateId = await sanjay.getByTestId("candidate-row").first().getAttribute("data-candidate-id");
  expect(firstCandidateId).toBeTruthy();

  await arul.locator(`[data-candidate-id="${firstCandidateId}"]`).click();

  const writerStatus = sanjay.getByTestId("status-select");
  const readerStatus = arul.getByTestId("status-select");
  const originalStatus = await writerStatus.inputValue();
  const nextStatus = originalStatus === "hold" ? "round1" : "hold";

  await writerStatus.selectOption(nextStatus);
  await expect(readerStatus).toHaveValue(nextStatus, { timeout: 10_000 });

  await writerStatus.selectOption(originalStatus);
  await expect(readerStatus).toHaveValue(originalStatus, { timeout: 10_000 });

  await sanjayContext.close();
  await arulContext.close();
});
