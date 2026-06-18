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
});
