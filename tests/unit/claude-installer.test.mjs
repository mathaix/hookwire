import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  expectedClaudeHookCommand,
  expectedClaudeHooks
} from "../../packages/agent-adapters/src/claude.mjs";
import { runDoctor, runInit } from "../../packages/installer/src/installer.mjs";

const fixedNow = new Date("2026-06-21T16:30:00.000Z");

async function withFixture(callback) {
  const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-claude-installer-"));
  try {
    const homeDir = path.join(fixture, "home");
    const projectDir = path.join(fixture, "project with spaces");
    await mkdir(homeDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    return await callback({ fixture, homeDir, projectDir });
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

describe("Claude installer integration", () => {
  it("adds Claude Code hook config while preserving existing hook groups", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const settingsPath = path.join(homeDir, ".claude/settings.json");
      const existingPostHook = {
        hooks: [{ command: "echo existing", type: "command" }],
        matcher: "Write"
      };
      await writeJson(settingsPath, {
        hooks: {
          PostToolUse: [existingPostHook]
        },
        theme: "dark"
      });

      const result = await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      const settings = await readJson(settingsPath);
      expect(result.agents[0]).toMatchObject({
        action: "updated",
        agent: "claude",
        backupCreated: true
      });
      expect(settings.theme).toBe("dark");
      expect(settings.hooks.PostToolUse).toContainEqual(existingPostHook);
      for (const [eventName, groups] of Object.entries(expectedClaudeHooks({ projectDir }))) {
        expect(settings.hooks[eventName]).toContainEqual(groups[0]);
      }
      expect(findHook(settings, "PreToolUse")).toEqual(expectedClaudeHookCommand({ eventName: "PreToolUse", projectDir }));
      expect(findHook(settings, "PermissionRequest")).toEqual(
        expectedClaudeHookCommand({ eventName: "PermissionRequest", projectDir })
      );
      expect(findHook(settings, "PostToolUse")).toEqual(expectedClaudeHookCommand({ eventName: "PostToolUse", projectDir }));
    });
  });

  it("doctor validates Claude hook config and detects tampered hook commands", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      const healthy = await runDoctor({ homeDir, projectDir });
      expect(healthy.agents.find((agent) => agent.agent === "claude")).toMatchObject({
        status: "healthy"
      });

      const settingsPath = path.join(homeDir, ".claude/settings.json");
      const settings = await readJson(settingsPath);
      findHook(settings, "PreToolUse").args = ["hook", "--agent", "claude", "--event", "PreToolUse", "--project", "/wrong"];
      await writeJson(settingsPath, settings);

      const tampered = await runDoctor({ homeDir, projectDir });
      const claude = tampered.agents.find((agent) => agent.agent === "claude");
      expect(claude).toMatchObject({
        status: "tampered"
      });
      expect(claude.actual.integrityCheck.status).toBe("tampered");
      expect(claude.expected.claudeHooks).toMatchObject(expectedClaudeHooks({ projectDir }));
      expect(claude.actual.claudeHooks.PreToolUse[0].hooks[0].args).toContain("/wrong");
    });
  });
});

function findHook(settings, eventName) {
  const group = settings.hooks[eventName].find((candidate) =>
    candidate.hooks.some((hook) => hook.command === "hookwire")
  );
  return group.hooks.find((hook) => hook.command === "hookwire");
}
