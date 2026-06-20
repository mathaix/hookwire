import { expect, test } from "@playwright/test";

test("creates and edits a routed policy rule with override settings", async ({ page }) => {
  await page.goto("/policies");

  await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Policy rules" })).toContainText("Deny production deletes");

  await page.getByRole("button", { name: "New rule" }).click();
  const editor = page.getByRole("form", { name: "Rule editor" });
  await editor.getByLabel("Rule name").fill("Route deploy approvals");
  await editor.getByLabel("Command prefix").fill("npm run deploy");
  await editor.getByLabel("Operation").selectOption("shell");
  await editor.getByLabel("Path pattern").fill("deploy/**");
  await editor.getByLabel("Risk tag").selectOption("high");
  await editor.getByLabel("Decision").selectOption("route");
  await editor.getByLabel("Route").selectOption("route-on-call");
  await editor.getByLabel("Allow local override").check();
  await editor.getByLabel("Override scope").selectOption("session");
  await editor.getByLabel("Require override reason").check();
  await editor.getByRole("button", { name: "Create rule" }).click();

  await expect(page.getByRole("table", { name: "Policy rules" })).toContainText("Route deploy approvals");
  await expect(page.getByTestId("selected-rule-detail")).toContainText("On-call reviewers");
  await expect(page.getByTestId("selected-rule-detail")).toContainText("session");
  await expect(page.getByTestId("selected-rule-detail")).toContainText("Override reason required");

  await page.getByRole("button", { name: "Edit Route deploy approvals" }).click();
  await editor.getByLabel("Rule name").fill("Route production deploys");
  await editor.getByLabel("Command pattern").fill("^npm run deploy(:prod)?$");
  await editor.getByRole("button", { name: "Save rule" }).click();

  await expect(page.getByRole("table", { name: "Policy rules" })).toContainText("Route production deploys");
  await expect(page.getByTestId("serialized-policy-bundle")).toContainText('"decision": "route"');
  await expect(page.getByTestId("serialized-policy-bundle")).toContainText('"routeId": "route-on-call"');
  await expect(page.getByTestId("serialized-policy-bundle")).toContainText('"maxScope": "session"');
});

test("keeps rule priority explicit and reorderable", async ({ page }) => {
  await page.goto("/policies");

  await expect(page.getByRole("table", { name: "Policy rules" })).toContainText("Deny production deletes");
  await page.getByRole("button", { name: "Move Ask for config writes up" }).click();

  const rows = page.getByRole("table", { name: "Policy rules" }).locator("tbody tr");
  await expect(rows.nth(0)).toContainText("Ask for config writes");
  await expect(rows.nth(0)).toContainText("10");
  await expect(rows.nth(1)).toContainText("Deny production deletes");
  await expect(rows.nth(1)).toContainText("20");
});

test("evaluates command, operation, path, and risk matchers in the UI", async ({ page }) => {
  await page.goto("/policies");

  await page.getByLabel("Simulated command").fill("python scripts/rewrite_config.py");
  await page.getByLabel("Simulated operation").selectOption("write_file");
  await page.getByLabel("Simulated path").fill(".hookwire/relay.json");
  await page.getByLabel("Simulated risk").selectOption("medium");
  await page.getByRole("button", { name: "Evaluate policy" }).click();

  await expect(page.getByTestId("policy-evaluation")).toContainText("Ask");
  await expect(page.getByTestId("policy-evaluation")).toContainText("Ask for config writes");
});
