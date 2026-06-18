import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildIssueCompletenessReport,
  checkArchitectureDecisions,
  checkContributorReadiness,
  findLegacyNameReferences,
  findMarkdownLinks,
  parseIssueIndex,
  resolveMarkdownLinks,
  runDocsVerification,
  _internal
} from "../../scripts/verify-docs.mjs";

const repoRoot = path.resolve(".");

describe("issue 001 docs verification", () => {
  it("finds all issue files listed in the backlog index", async () => {
    const issues = await parseIssueIndex(path.join(repoRoot, "docs/issues/README.md"));
    const report = await buildIssueCompletenessReport(repoRoot, issues);

    expect(issues).toHaveLength(21);
    expect(report.missing).toEqual([]);
    expect(report.present).toHaveLength(21);
  });

  it("rejects missing issue files from the backlog index", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-docs-"));
    try {
      await mkdir(path.join(fixture, "docs/issues"), { recursive: true });
      await writeFile(
        path.join(fixture, "docs/issues/README.md"),
        "1. [Missing issue](999-missing.md)\n",
        "utf8"
      );

      const issues = await parseIssueIndex(path.join(fixture, "docs/issues/README.md"));
      const report = await buildIssueCompletenessReport(fixture, issues);

      expect(report.missing).toEqual(["docs/issues/999-missing.md"]);
      expect(report.present).toEqual([]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("resolves local Markdown links from project docs", async () => {
    const links = await findMarkdownLinks(repoRoot, ["README.md", "docs/issues/README.md"]);
    const report = await resolveMarkdownLinks(repoRoot, links);

    expect(links.length).toBeGreaterThan(0);
    expect(report.missing).toEqual([]);
    expect(report.checked.length).toBeGreaterThan(0);
  });

  it("ignores external and same-page anchor Markdown links", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-external-links-"));
    try {
      await writeFile(
        path.join(fixture, "README.md"),
        "[External](https://example.com)\n[Anchor](#section)\n[Mail](mailto:test@example.com)\n",
        "utf8"
      );

      const links = await findMarkdownLinks(fixture, ["README.md"]);

      expect(links).toEqual([]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("reports broken local Markdown links", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-links-"));
    try {
      await writeFile(path.join(fixture, "README.md"), "[Broken](docs/missing.md)\n", "utf8");

      const links = await findMarkdownLinks(fixture, ["README.md"]);
      const report = await resolveMarkdownLinks(fixture, links);

      expect(report.missing).toEqual([
        {
          source: "README.md",
          target: "docs/missing.md",
          resolved: "docs/missing.md"
        }
      ]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("proves current product docs do not contain the legacy product name", async () => {
    const matches = await findLegacyNameReferences(repoRoot, {
      legacyName: "Hookrail",
      ignoreGlobs: ["docs/issues/001-project-foundation.md", "docs/reviews/**"]
    });

    expect(matches).toEqual([]);
  });

  it("detects legacy product names outside ignored paths", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-legacy-"));
    try {
      await mkdir(path.join(fixture, "docs"), { recursive: true });
      await writeFile(path.join(fixture, "docs/bad.md"), "Hookrail\n", "utf8");

      const matches = await findLegacyNameReferences(fixture, {
        legacyName: "Hookrail",
        ignoreGlobs: []
      });

      expect(matches).toEqual([{ file: "docs/bad.md", line: 1, text: "Hookrail" }]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("honors exact-file and directory ignore globs for legacy product names", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-ignored-legacy-"));
    try {
      await mkdir(path.join(fixture, "docs/reviews"), { recursive: true });
      await writeFile(path.join(fixture, "README.md"), "Hookrail\n", "utf8");
      await writeFile(path.join(fixture, "docs/reviews/review.md"), "Hookrail\n", "utf8");
      await writeFile(path.join(fixture, "docs/allowed.md"), "Hookrail\n", "utf8");

      const matches = await findLegacyNameReferences(fixture, {
        legacyName: "Hookrail",
        ignoreGlobs: ["README.md", "docs/reviews/**"]
      });

      expect(matches).toEqual([{ file: "docs/allowed.md", line: 1, text: "Hookrail" }]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("returns no legacy references when the scan root is missing", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-missing-root-"));
    try {
      const matches = await findLegacyNameReferences(path.join(fixture, "missing"), {
        legacyName: "Hookrail"
      });

      expect(matches).toEqual([]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("detects legacy references when the scan root is not a Markdown file", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-non-md-root-"));
    try {
      const textFile = path.join(fixture, "notes.txt");
      await writeFile(textFile, "Hookrail\n", "utf8");

      const matches = await findLegacyNameReferences(textFile, {
        legacyName: "Hookrail"
      });

      expect(matches).toEqual([{ file: "notes.txt", line: 1, text: "Hookrail" }]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("uses the default legacy product name when none is provided", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-default-legacy-"));
    try {
      await writeFile(path.join(fixture, "README.md"), "Hookrail\n", "utf8");

      const matches = await findLegacyNameReferences(fixture);

      expect(matches).toEqual([{ file: "README.md", line: 1, text: "Hookrail" }]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("checks contributor readiness links in the README", async () => {
    const readiness = await checkContributorReadiness(repoRoot);

    expect(readiness.missing).toEqual([]);
    expect(readiness.requiredTargets).toEqual([
      "docs/architecture.md",
      "docs/data-model.md",
      "docs/issues/README.md",
      "docs/implementation-plan.md",
      "docs/verification.md"
    ]);
  });

  it("supports custom contributor readiness targets", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-readiness-"));
    try {
      await writeFile(path.join(fixture, "README.md"), "docs/one.md\n", "utf8");

      const readiness = await checkContributorReadiness(fixture, ["docs/one.md", "docs/two.md"]);

      expect(readiness.requiredTargets).toEqual(["docs/one.md", "docs/two.md"]);
      expect(readiness.missing).toEqual(["docs/two.md"]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("checks core architecture decisions from issue 001", async () => {
    const decisions = await checkArchitectureDecisions(repoRoot);

    expect(decisions.missing).toEqual([]);
    expect(decisions.requiredStatements).toEqual([
      { file: "README.md", text: "Postgres is the source of truth" },
      { file: "README.md", text: "NATS/JetStream is not required for v1" },
      { file: "docs/architecture.md", text: "### Local Machine" },
      { file: "docs/architecture.md", text: "### Backend" },
      { file: "docs/architecture.md", text: "Postgres for canonical state" },
      { file: "docs/architecture.md", text: "NATS is optional for v1" }
    ]);
  });

  it("reports missing architecture decisions", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-decisions-"));
    try {
      await mkdir(path.join(fixture, "docs"), { recursive: true });
      await writeFile(path.join(fixture, "README.md"), "Hookwire\n", "utf8");
      await writeFile(path.join(fixture, "docs/architecture.md"), "Architecture\n", "utf8");

      const decisions = await checkArchitectureDecisions(fixture);

      expect(decisions.missing).toHaveLength(6);
      expect(decisions.missing[0]).toEqual({
        file: "README.md",
        text: "Postgres is the source of truth"
      });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("covers defensive file walking branches", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-walk-"));
    try {
      const markdownFile = path.join(fixture, "single.md");
      const textFile = path.join(fixture, "single.txt");
      await writeFile(markdownFile, "# Single\n", "utf8");
      await writeFile(textFile, "Single\n", "utf8");

      expect(await _internal.listMarkdownFiles(path.join(fixture, "missing"))).toEqual([]);
      expect(await _internal.listMarkdownFiles(markdownFile)).toEqual([markdownFile]);
      expect(await _internal.listMarkdownFiles(textFile)).toEqual([]);
      expect(await _internal.listFiles(path.join(fixture, "missing"))).toEqual([]);
      expect(await _internal.listFiles(textFile)).toEqual([textFile]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("returns a failing summary when any required docs contract is broken", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-summary-"));
    try {
      await mkdir(path.join(fixture, "docs/issues"), { recursive: true });
      await writeFile(path.join(fixture, "README.md"), "Hookwire\n[Broken](docs/missing.md)\n", "utf8");
      await writeFile(path.join(fixture, "docs/issues/README.md"), "1. [Missing](001-missing.md)\n", "utf8");

      const report = await runDocsVerification(fixture);

      expect(report.ok).toBe(false);
      expect(report.issues.missing).toEqual(["docs/issues/001-missing.md"]);
      expect(report.links.missing).toEqual([
        {
          source: "README.md",
          target: "docs/missing.md",
          resolved: "docs/missing.md"
        },
        {
          source: "docs/issues/README.md",
          target: "001-missing.md",
          resolved: "docs/issues/001-missing.md"
        }
      ]);
      expect(report.readiness.missing.length).toBeGreaterThan(0);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("returns a passing summary for the current repository docs", async () => {
    const report = await runDocsVerification(repoRoot);
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");

    expect(readme).toContain("Hookwire");
    expect(report.ok).toBe(true);
    expect(report.issues.present).toHaveLength(21);
    expect(report.links.missing).toEqual([]);
    expect(report.legacyName.matches).toEqual([]);
    expect(report.readiness.missing).toEqual([]);
    expect(report.decisions.missing).toEqual([]);
  });
});
