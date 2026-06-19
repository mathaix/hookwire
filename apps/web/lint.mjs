import { access, readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve("apps/web/app");
const requiredRoutes = [
  "page.tsx",
  "sessions/page.tsx",
  "policies/page.tsx",
  "routes/page.tsx",
  "integrations/page.tsx",
  "audit/page.tsx",
  "settings/page.tsx"
];
const forbiddenMarketingCopy = ["Get started with Hookwire", "Hero", "Book a demo"];

const missing = [];
for (const route of requiredRoutes) {
  try {
    await access(path.join(appRoot, route));
  } catch {
    missing.push(route);
  }
}

const rootPage = await readFile(path.join(appRoot, "page.tsx"), "utf8");
const forbidden = forbiddenMarketingCopy.filter((copy) => rootPage.includes(copy));

if (missing.length > 0 || forbidden.length > 0) {
  console.error(JSON.stringify({ ok: false, missing, forbidden }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, routes: requiredRoutes.length }, null, 2));
}
