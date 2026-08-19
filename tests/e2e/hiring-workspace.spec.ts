import { expect, test } from "@playwright/test";

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

test("opens candidate tabs on mobile without sticky hero overlap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "sanjay@complyance.io");

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
    "No hire",
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
