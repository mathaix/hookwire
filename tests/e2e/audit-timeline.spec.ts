import { expect, test } from "@playwright/test";

test("shows approval, policy, route, identity, session, and local override audit events", async ({ page }) => {
  await page.goto("/audit");

  const timeline = page.getByTestId("audit-timeline");
  await expect(timeline.getByText("approval.requested")).toBeVisible();
  await expect(timeline.getByText("approval.approved")).toBeVisible();
  await expect(timeline.getByText("policy.changed")).toBeVisible();
  await expect(timeline.getByText("route.changed")).toBeVisible();
  await expect(timeline.getByText("key.registered")).toBeVisible();
  await expect(timeline.getByText("key.revoked")).toBeVisible();
  await expect(timeline.getByText("session.claimed")).toBeVisible();
  await expect(timeline.getByText("local_override.used")).toBeVisible();
});

test("filters audit timeline by project, entity, and user", async ({ page }) => {
  await page.goto("/audit");

  const filters = page.getByRole("form", { name: "Audit filters" });
  await filters.getByLabel("Project").selectOption("project-web");
  await filters.getByLabel("Entity").selectOption("agent_session");
  await filters.getByLabel("User").selectOption("user-maya");

  const timeline = page.getByTestId("audit-timeline");
  await expect(timeline.getByText("session.claimed")).toBeVisible();
  await expect(timeline.getByText("approval.requested")).toHaveCount(0);
  await expect(page.getByTestId("audit-empty")).toHaveCount(0);

  await filters.getByLabel("Entity").selectOption("policy");
  await expect(page.getByTestId("audit-empty")).toBeVisible();
});

test("shows redacted audit metadata in event detail", async ({ page }) => {
  await page.goto("/audit");

  await page.getByRole("button", { name: /local_override.used/ }).click();

  const detail = page.getByTestId("audit-detail");
  await expect(detail.getByText("local_override.used")).toBeVisible();
  await expect(detail).toContainText("[REDACTED]");
  await expect(detail).not.toContainText("sk-live-super-secret");
  await expect(detail).not.toContainText("raw-super-token");
  await expect(detail).not.toContainText("ghp_rawgithubtoken");
});
