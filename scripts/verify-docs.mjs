import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_README_TARGETS = [
  "docs/architecture.md",
  "docs/data-model.md",
  "docs/issues/README.md",
  "docs/implementation-plan.md",
  "docs/verification.md"
];

const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const CI_REQUIRED_SIGNALS = [
  {
    label: "pull_request trigger",
    matches: (text) => text.includes("pull_request:")
  },
  {
    label: "main push trigger",
    matches: (text) => text.includes("push:") && text.includes("branches:") && text.includes("main")
  },
  {
    label: "npm ci",
    matches: (text) => text.includes("npm ci")
  },
  {
    label: "Node version from .nvmrc",
    matches: (text) => text.includes("node-version-file: .nvmrc")
  },
  {
    label: "npm run test:unit",
    matches: (text) => text.includes("npm run test:unit")
  },
  {
    label: "npm run verify:docs",
    matches: (text) => text.includes("npm run verify:docs")
  },
  {
    label: "npx playwright install --with-deps chromium",
    matches: (text) => text.includes("npx playwright install --with-deps chromium")
  },
  {
    label: "npm run test:e2e",
    matches: (text) => text.includes("npm run test:e2e")
  },
  {
    label: "Playwright failure artifact upload",
    matches: (text) => text.includes("actions/upload-artifact") && text.includes("playwright-report") && text.includes("test-results")
  },
  {
    label: "Playwright browser cache",
    matches: (text) => text.includes("actions/cache") && text.includes("~/.cache/ms-playwright")
  },
  {
    label: "SHA-pinned GitHub actions",
    matches: (text) =>
      /actions\/checkout@[a-f0-9]{40}/.test(text) &&
      /actions\/setup-node@[a-f0-9]{40}/.test(text) &&
      /actions\/cache@[a-f0-9]{40}/.test(text) &&
      /actions\/upload-artifact@[a-f0-9]{40}/.test(text)
  },
  {
    label: "read-only contents permission",
    matches: (text) => text.includes("permissions:") && text.includes("contents: read")
  }
];

const GOVERNANCE_REQUIRED_STATEMENTS = [
  { file: "README.md", text: "CONTRIBUTING.md" },
  { file: ".nvmrc", text: "22" },
  { file: "CONTRIBUTING.md", text: "Node.js 22" },
  { file: "CONTRIBUTING.md", text: "npm ci" },
  { file: "CONTRIBUTING.md", text: "npm run test:unit" },
  { file: "CONTRIBUTING.md", text: "npm run verify:docs" },
  { file: "CONTRIBUTING.md", text: "npm run test:e2e" },
  { file: "CONTRIBUTING.md", text: "pull request" },
  { file: "CONTRIBUTING.md", text: "direct pushes to `main` are blocked" },
  { file: "CONTRIBUTING.md", text: "required status checks" },
  { file: "CONTRIBUTING.md", text: "Administrator bypass is disabled by default" }
];

const ISSUE_LINK_PATTERN = /^\s*\d+\.\s+\[[^\]]+\]\(([^)]+)\)/gm;
const MARKDOWN_LINK_PATTERN = /\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g;

export async function parseIssueIndex(indexPath) {
  const text = await readFile(indexPath, "utf8");
  return [...text.matchAll(ISSUE_LINK_PATTERN)].map((match) => ({
    target: match[1],
    path: path.posix.join("docs/issues", match[1])
  }));
}

export async function buildIssueCompletenessReport(repoRoot, issues) {
  const present = [];
  const missing = [];

  for (const issue of issues) {
    const fullPath = path.join(repoRoot, issue.path);
    if (await exists(fullPath)) {
      present.push(issue.path);
    } else {
      missing.push(issue.path);
    }
  }

  return { present, missing };
}

export async function findMarkdownLinks(repoRoot, relativeFiles) {
  const links = [];

  for (const relativeFile of relativeFiles) {
    const text = await readFile(path.join(repoRoot, relativeFile), "utf8");
    for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
      const target = match[1];
      if (isExternalLink(target)) {
        continue;
      }
      links.push({ source: relativeFile, target });
    }
  }

  return links;
}

export async function resolveMarkdownLinks(repoRoot, links) {
  const checked = [];
  const missing = [];

  for (const link of links) {
    const resolved = path.normalize(path.join(path.dirname(link.source), link.target));
    const fullPath = path.join(repoRoot, resolved);
    const record = { ...link, resolved };

    if (await exists(fullPath)) {
      checked.push(record);
    } else {
      missing.push(record);
    }
  }

  return { checked, missing };
}

export async function findLegacyNameReferences(repoRoot, options = {}) {
  const legacyName = options.legacyName ?? "Hookrail";
  const ignoreGlobs = options.ignoreGlobs ?? [];
  const files = await listLegacyScanFiles(repoRoot, options.scanRoots ?? ["README.md", "docs"]);
  const relativeRoot = (await isFile(repoRoot)) ? path.dirname(repoRoot) : repoRoot;
  const matches = [];

  for (const file of files) {
    const relative = toPosix(path.relative(relativeRoot, file));
    if (isIgnored(relative, ignoreGlobs)) {
      continue;
    }

    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      if (lineText.includes(legacyName)) {
        matches.push({ file: relative, line: index + 1, text: lineText });
      }
    });
  }

  return matches;
}

async function isFile(filePath) {
  if (!(await exists(filePath))) {
    return false;
  }
  return (await lstat(filePath)).isFile();
}

async function listLegacyScanFiles(repoRoot, scanRoots) {
  if (!(await exists(repoRoot))) {
    return [];
  }

  const stat = await lstat(repoRoot);
  if (stat.isFile()) {
    return [repoRoot];
  }

  const files = [];
  for (const scanRoot of scanRoots) {
    files.push(...(await listFiles(path.join(repoRoot, scanRoot))));
  }
  return files.sort();
}

export async function checkContributorReadiness(repoRoot, requiredTargets = DEFAULT_README_TARGETS) {
  const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
  const missing = [];

  for (const target of requiredTargets) {
    if (!readme.includes(target)) {
      missing.push(target);
    }
  }

  return { requiredTargets, missing };
}

export async function checkArchitectureDecisions(repoRoot) {
  const files = {
    "README.md": await readOptionalText(path.join(repoRoot, "README.md")),
    "docs/architecture.md": await readOptionalText(path.join(repoRoot, "docs/architecture.md"))
  };
  const requiredStatements = [
    {
      file: "README.md",
      text: "Postgres is the source of truth"
    },
    {
      file: "README.md",
      text: "NATS/JetStream is not required for v1"
    },
    {
      file: "docs/architecture.md",
      text: "### Local Machine"
    },
    {
      file: "docs/architecture.md",
      text: "### Backend"
    },
    {
      file: "docs/architecture.md",
      text: "Postgres for canonical state"
    },
    {
      file: "docs/architecture.md",
      text: "NATS is optional for v1"
    }
  ];
  const missing = requiredStatements.filter((statement) => !files[statement.file].includes(statement.text));

  return { requiredStatements, missing };
}

export async function checkGitHubActionsCi(repoRoot) {
  const workflowPath = CI_WORKFLOW_PATH;
  const workflowFullPath = path.join(repoRoot, workflowPath);
  const workflowExists = await exists(workflowFullPath);
  const text = workflowExists ? await readFile(workflowFullPath, "utf8") : "";
  const requiredSignals = CI_REQUIRED_SIGNALS.map((signal) => signal.label);
  const missing = [];

  if (!workflowExists) {
    missing.push(`workflow file ${workflowPath}`);
  }

  for (const signal of CI_REQUIRED_SIGNALS) {
    if (!signal.matches(text)) {
      missing.push(signal.label);
    }
  }

  return { workflowPath, requiredSignals, missing };
}

export async function checkOpenSourceGovernance(repoRoot) {
  const files = {};
  const requiredFiles = [...new Set(GOVERNANCE_REQUIRED_STATEMENTS.map((statement) => statement.file))];

  for (const file of requiredFiles) {
    files[file] = await readOptionalText(path.join(repoRoot, file));
  }

  const missing = GOVERNANCE_REQUIRED_STATEMENTS.filter((statement) => !files[statement.file].includes(statement.text));

  return { requiredStatements: GOVERNANCE_REQUIRED_STATEMENTS, missing };
}

async function readOptionalText(filePath) {
  if (!(await exists(filePath))) {
    return "";
  }
  return readFile(filePath, "utf8");
}

export async function runDocsVerification(repoRoot = path.resolve(".")) {
  const issues = await parseIssueIndex(path.join(repoRoot, "docs/issues/README.md"));
  const issueReport = await buildIssueCompletenessReport(repoRoot, issues);
  const markdownFiles = ["README.md", ...(await listMarkdownFiles(path.join(repoRoot, "docs"))).map((file) => toPosix(path.relative(repoRoot, file)))];
  const links = await findMarkdownLinks(repoRoot, markdownFiles);
  const linkReport = await resolveMarkdownLinks(repoRoot, links);
  const legacyMatches = await findLegacyNameReferences(repoRoot, {
    legacyName: "Hookrail",
    ignoreGlobs: ["docs/issues/001-project-foundation.md", "docs/reviews/**"]
  });
  const readiness = await checkContributorReadiness(repoRoot);
  const decisions = await checkArchitectureDecisions(repoRoot);
  const ci = await checkGitHubActionsCi(repoRoot);
  const governance = await checkOpenSourceGovernance(repoRoot);

  return {
    ok:
      issueReport.missing.length === 0 &&
      linkReport.missing.length === 0 &&
      legacyMatches.length === 0 &&
      readiness.missing.length === 0 &&
      decisions.missing.length === 0 &&
      ci.missing.length === 0 &&
      governance.missing.length === 0,
    issues: issueReport,
    links: linkReport,
    legacyName: { name: "Hookrail", matches: legacyMatches },
    readiness,
    decisions,
    ci,
    governance
  };
}

async function listMarkdownFiles(root) {
  if (!(await exists(root))) {
    return [];
  }

  const stat = await lstat(root);
  if (stat.isFile()) {
    return root.endsWith(".md") ? [root] : [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function listFiles(root) {
  if (!(await exists(root))) {
    return [];
  }

  const stat = await lstat(root);
  if (stat.isFile()) {
    return [root];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function isExternalLink(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#");
}

function isIgnored(relativePath, ignoreGlobs) {
  return ignoreGlobs.some((glob) => matchesSimpleGlob(relativePath, glob));
}

function matchesSimpleGlob(relativePath, glob) {
  const normalizedGlob = toPosix(glob);
  if (normalizedGlob.endsWith("/**")) {
    return relativePath.startsWith(normalizedGlob.slice(0, -2));
  }
  return relativePath === normalizedGlob;
}

function toPosix(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    /* v8 ignore next -- unexpected filesystem errors should propagate, not be handled as verification misses. */
    throw error;
  }
}

export const _internal = {
  listFiles,
  listMarkdownFiles
};

/* v8 ignore start -- CLI wrapper is exercised through npm scripts; unit coverage targets reusable verifier logic. */
async function main() {
  const report = await runDocsVerification(path.resolve("."));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
/* v8 ignore stop */
