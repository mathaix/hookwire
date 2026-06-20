import { expect, test } from "@playwright/test";

const knownSecret = "sk-live-super-secret";

test("filters sessions by project, agent, status, risk, and date", async ({ page }) => {
  await page.goto("/sessions");

  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Agent sessions" })).toContainText("codex-7f31");
  await expect(page.getByRole("table", { name: "Agent sessions" })).toContainText("claude-a88c");
  await expect(page.getByRole("table", { name: "Agent sessions" })).toContainText("openclaw-19b2");

  const filters = page.getByRole("region", { name: "Session filters" });
  await filters.getByLabel("Project").selectOption("project-hookwire-web");
  await filters.getByLabel("Agent").selectOption("codex");
  await filters.getByLabel("Status").selectOption("active");
  await filters.getByLabel("Risk").selectOption("high");
  await filters.getByLabel("Date").selectOption("today");

  await expect(page.getByRole("table", { name: "Agent sessions" })).toContainText("codex-7f31");
  await expect(page.getByRole("table", { name: "Agent sessions" })).not.toContainText("claude-a88c");
  await expect(page.getByRole("table", { name: "Agent sessions" })).not.toContainText("openclaw-19b2");
  await expect(page.getByTestId("session-metrics")).toContainText("1 total");
});

test("shows linked session detail with redacted hook events, approvals, and decisions", async ({ page }) => {
  await page.goto("/sessions?session=codex-7f31");

  await expect(page.getByTestId("session-detail")).toContainText("codex-7f31");
  await expect(page.getByTestId("session-detail")).toContainText("Hook events");
  await expect(page.getByTestId("session-detail")).toContainText("npm run db:migrate");
  await expect(page.getByTestId("session-detail")).toContainText("Approval requests");
  await expect(page.getByTestId("session-detail")).toContainText("Apply migration and write project settings");
  await expect(page.getByTestId("session-detail")).toContainText("Decisions");
  await expect(page.getByTestId("session-detail")).toContainText("Reviewed migration");
  await expect(page.getByText(knownSecret)).toHaveCount(0);
  await expect(page.getByText("local-dev-password")).toHaveCount(0);
});

test("supports empty filtered session results", async ({ page }) => {
  await page.goto("/sessions?agent=openclaw&status=active");

  await expect(page.getByTestId("session-empty-state")).toContainText("No sessions match these filters");
  await expect(page.getByRole("table", { name: "Agent sessions" })).toHaveCount(0);
});
