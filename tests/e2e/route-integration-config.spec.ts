import { expect, test } from "@playwright/test";

test("configures a web inbox route target with approvals, timeout, and fallback", async ({ page }) => {
  await page.goto("/routes");

  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Routes" })).toContainText("Web inbox");
  await expect(page.getByRole("table", { name: "Route targets" })).toContainText("web_inbox");

  const routeForm = page.getByRole("form", { name: "Route settings" });
  await routeForm.getByLabel("Approvals required").fill("2");
  await routeForm.getByLabel("Timeout seconds").fill("1200");
  await routeForm.getByLabel("Fallback route").selectOption("route-local-terminal");
  await routeForm.getByRole("button", { name: "Save route" }).click();

  await expect(page.getByTestId("selected-route-detail")).toContainText("2 approvals");
  await expect(page.getByTestId("selected-route-detail")).toContainText("1200 seconds");
  await expect(page.getByTestId("selected-route-detail")).toContainText("Fallback terminal");

  const targetEditor = page.getByRole("form", { name: "Target editor" });
  await targetEditor.getByLabel("Target type").selectOption("web_inbox");
  await targetEditor.getByLabel("Approval group").selectOption("group-engineering");
  await targetEditor.getByLabel("Recipient mode").selectOption("group");
  await targetEditor.getByLabel("Target priority").fill("5");
  await targetEditor.getByRole("button", { name: "Add target" }).click();

  await expect(page.getByRole("table", { name: "Route targets" })).toContainText("Engineering reviewers");
  await expect(page.getByRole("table", { name: "Route targets" })).toContainText("group");
});

test("represents every provider target type before workers exist", async ({ page }) => {
  await page.goto("/routes");

  const providerMatrix = page.getByTestId("provider-matrix");
  for (const provider of ["Web inbox", "Slack", "SMS", "Jira", "Linear", "Email", "GitHub", "Webhook", "Local terminal"]) {
    await expect(providerMatrix).toContainText(provider);
  }
  await expect(providerMatrix).toContainText("modeled");
  await expect(providerMatrix).toContainText("worker pending");
});

test("shows group and on-call route targets in route detail", async ({ page }) => {
  await page.goto("/routes");

  await expect(page.getByRole("table", { name: "Route targets" })).toContainText("Engineering reviewers");
  await expect(page.getByRole("table", { name: "Route targets" })).toContainText("Release on-call");
  await expect(page.getByRole("table", { name: "Route targets" })).toContainText("current owner Maya");
});
