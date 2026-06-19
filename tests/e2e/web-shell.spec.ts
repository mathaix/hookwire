import { expect, test } from "@playwright/test";

const sections = [
  { label: "Inbox", path: "/", heading: "Pending approvals" },
  { label: "Sessions", path: "/sessions", heading: "Sessions" },
  { label: "Policies", path: "/policies", heading: "Policies" },
  { label: "Routes", path: "/routes", heading: "Routes" },
  { label: "Integrations", path: "/integrations", heading: "Integrations" },
  { label: "Audit", path: "/audit", heading: "Audit timeline" },
  { label: "Settings", path: "/settings", heading: "Settings" }
];

test("root opens the operational dashboard instead of a marketing page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("topbar")).toContainText("Organization");
  await expect(page.getByTestId("topbar")).toContainText("Project");
  await expect(page.getByRole("navigation", { name: "Primary" })).toContainText("Hookwire");
  await expect(page.getByRole("heading", { name: "Pending approvals" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Pending approval requests" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve selected approval" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deny selected approval" })).toBeVisible();
  await expect(page.getByText("Get started with Hookwire")).toHaveCount(0);
});

test("primary navigation routes are stable", async ({ page }) => {
  for (const section of sections) {
    await page.goto(section.path);

    await expect(page.getByRole("heading", { name: section.heading })).toBeVisible();
    await expect(page.getByRole("link", { name: section.label })).toHaveAttribute("aria-current", "page");
  }
});

test("desktop layout supports dense operational data", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  await expect(page.getByTestId("app-shell")).toHaveCSS("display", "grid");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByTestId("approval-list")).toBeVisible();
  await expect(page.getByTestId("approval-detail")).toBeVisible();
  await expect(page.getByTestId("session-activity")).toBeVisible();
  await expect(page.getByTestId("route-health")).toBeVisible();
});

test("mobile layout keeps approval review usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCSS("overflow-x", "auto");
  await expect(page.getByRole("heading", { name: "Pending approvals" })).toBeVisible();
  await expect(page.getByTestId("approval-list")).toBeVisible();
  await expect(page.getByTestId("approval-detail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve selected approval" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deny selected approval" })).toBeVisible();
});

test("section tables keep dense data scrollable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sessions");

  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByTestId("section-table-wrap")).toHaveCSS("overflow-x", "auto");
  await expect(page.getByRole("table", { name: "Agent sessions" })).toBeVisible();
});
