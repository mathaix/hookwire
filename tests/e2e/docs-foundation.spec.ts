import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(".");

test("README exposes the contributor foundation docs", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(repoRoot, "README.md")).href);

  await expect(page.locator("body")).toContainText("Hookwire");
  await expect(page.locator("body")).toContainText("docs/architecture.md");
  await expect(page.locator("body")).toContainText("docs/data-model.md");
  await expect(page.locator("body")).toContainText("docs/issues");
  await expect(page.locator("body")).toContainText("docs/implementation-plan.md");
  await expect(page.locator("body")).toContainText("docs/verification.md");
  await expect(page.locator("body")).toContainText("CONTRIBUTING.md");
});

test("CONTRIBUTING documents local CI and main protection expectations", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(repoRoot, "CONTRIBUTING.md")).href);

  await expect(page.locator("body")).toContainText("npm ci");
  await expect(page.locator("body")).toContainText("npm run test:unit");
  await expect(page.locator("body")).toContainText("npm run verify:docs");
  await expect(page.locator("body")).toContainText("npm run test:e2e");
  await expect(page.locator("body")).toContainText("direct pushes to `main` are blocked");
  await expect(page.locator("body")).toContainText("required status checks");
  await expect(page.locator("body")).toContainText("Verification");
  await expect(page.locator("body")).toContainText("Administrator bypass is disabled by default");
});

test("temporary failure proof", async () => {
  expect(false).toBe(true);
});
