import { expect, test } from "@playwright/test";

const knownSecret = "sk-live-super-secret";

test("renders pending approvals with redacted request detail", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Pending approvals" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Approval inbox requests" })).toContainText("APR-1042");
  await expect(page.getByRole("table", { name: "Approval inbox requests" })).toContainText("APR-1041");
  await expect(page.getByTestId("approval-detail")).toContainText("Default write guard");
  await expect(page.getByTestId("approval-detail")).toContainText("Web inbox");
  await expect(page.getByTestId("approval-detail")).toContainText("codex-7f31");
  await expect(page.getByTestId("approval-detail")).toContainText("Redacted payload");
  await expect(page.getByText(knownSecret)).toHaveCount(0);
  await expect(page.getByText("local-dev-password")).toHaveCount(0);
});

test("approves a request once and records an audit event", async ({ page }) => {
  await page.goto("/?select=APR-1042");

  await page.getByRole("button", { name: "Approve APR-1042 once" }).click();

  await expect(page.getByTestId("approval-detail")).toContainText("Approved");
  await expect(page.getByTestId("approval-status-APR-1042")).toHaveText("Approved");
  await expect(page.getByRole("button", { name: "Approve APR-1042 once" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Deny APR-1042 once" })).toBeDisabled();
  await expect(page.getByTestId("audit-events").getByText("approval.approved")).toHaveCount(1);
});

test("changes selected request when a row is clicked after URL preselection", async ({ page }) => {
  await page.goto("/?select=APR-1042");

  await page.getByRole("button", { name: "Review APR-1041" }).click();

  await expect(page.getByTestId("approval-detail")).toContainText("APR-1041");
  await expect(page.getByTestId("approval-detail")).toContainText("Relay config guard");
  await expect(page.getByRole("button", { name: "Deny APR-1041 once" })).toBeEnabled();
});

test("requires denial reason and records a denial audit event", async ({ page }) => {
  await page.goto("/?select=APR-1041");

  await page.getByRole("button", { name: "Deny APR-1041 once" }).click();

  await expect(page.getByTestId("approval-detail").getByRole("alert")).toContainText("Reason required to deny APR-1041");

  await page.getByLabel("Decision reason").fill("Relay config patch touches protected routing");
  await page.getByRole("button", { name: "Deny APR-1041 once" }).click();

  await expect(page.getByTestId("approval-detail")).toContainText("Denied");
  await expect(page.getByTestId("approval-status-APR-1041")).toHaveText("Denied");
  await expect(page.getByRole("button", { name: "Approve APR-1041 once" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Deny APR-1041 once" })).toBeDisabled();
  await expect(page.getByTestId("audit-events").getByText("approval.denied")).toHaveCount(1);
});

test("shows expired and unauthorized approval states", async ({ page }) => {
  await page.goto("/?select=APR-1039");

  await expect(page.getByTestId("approval-detail")).toContainText("Expired");
  await expect(page.getByTestId("approval-detail")).toContainText("This request expired before a decision was recorded.");
  await expect(page.getByRole("button", { name: "Approve APR-1039 once" })).toBeDisabled();

  await page.goto("/?persona=viewer&select=APR-1042");

  await expect(page.getByTestId("approval-detail")).toContainText("Unauthorized reviewer");
  await expect(page.getByRole("button", { name: "Approve APR-1042 once" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Deny APR-1042 once" })).toBeDisabled();
});

test("shows empty and loading inbox states", async ({ page }) => {
  await page.goto("/?scenario=empty");

  await expect(page.getByTestId("approval-empty-state")).toContainText("No approval requests");
  await expect(page.getByRole("table", { name: "Approval inbox requests" })).toHaveCount(0);

  await page.goto("/?scenario=loading");

  await expect(page.getByTestId("approval-loading-state")).toContainText("Loading approval requests");
});
