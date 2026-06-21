import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CURRENT_HOOKWIRE_CONFIG_VERSION,
  detectAgents,
  expectedHookwireConfig,
  runDoctor,
  runInit
} from "../../packages/installer/src/installer.mjs";

const fixedNow = new Date("2026-06-21T15:30:00.000Z");

async function withFixture(callback) {
  const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-installer-"));
  try {
    const homeDir = path.join(fixture, "home");
    const projectDir = path.join(fixture, "project");
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

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function mode(filePath) {
  return (await stat(filePath)).mode & 0o777;
}

describe("installer framework", () => {
  it("detects Claude Code, Codex, and OpenClaw config states without creating files", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await writeJson(path.join(homeDir, ".claude/settings.json"), { theme: "dark" });
      await writeJson(path.join(homeDir, ".openclaw/config.json"), { workspace: "default" });

      const detected = await detectAgents({ homeDir, projectDir });

      expect(detected.map((agent) => [agent.agent, agent.detected, agent.configExists])).toEqual([
        ["claude", true, true],
        ["codex", false, false],
        ["openclaw", true, true]
      ]);
      expect(await exists(path.join(homeDir, ".codex/config.json"))).toBe(false);
    });
  });

  it("reports an agent directory as detected even before config exists", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await mkdir(path.join(homeDir, ".codex"), { recursive: true });

      const detected = await detectAgents({ homeDir, projectDir });

      expect(detected.map((agent) => [agent.agent, agent.detected, agent.configExists])).toEqual([
        ["claude", false, false],
        ["codex", true, false],
        ["openclaw", false, false]
      ]);
    });
  });

  it("supports dry-run init without modifying config files or creating backups", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      await writeJson(claudeConfigPath, { existing: true });
      const before = await readFile(claudeConfigPath, "utf8");

      const result = await runInit({
        dryRun: true,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude", "codex"]
      });

      expect(result.dryRun).toBe(true);
      expect(result.agents.map((agent) => [agent.agent, agent.action])).toEqual([
        ["claude", "would_update"],
        ["codex", "would_create"]
      ]);
      expect(result.agents[0].backupPath).toContain(".hookwire-backups");
      expect(await readFile(claudeConfigPath, "utf8")).toBe(before);
      expect(await exists(path.join(homeDir, ".claude/.hookwire-backups"))).toBe(false);
      expect(await exists(path.join(homeDir, ".codex/config.json"))).toBe(false);
    });
  });

  it("reruns init without rewriting already healthy Hookwire config", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      const before = await readFile(claudeConfigPath, "utf8");
      const result = await runInit({
        dryRun: false,
        homeDir,
        now: new Date("2026-06-22T15:30:00.000Z"),
        projectDir,
        selectedAgents: ["claude"]
      });

      expect(result.agents[0]).toMatchObject({
        action: "unchanged",
        agent: "claude",
        backupCreated: false,
        backupPath: null
      });
      expect(await readFile(claudeConfigPath, "utf8")).toBe(before);
      expect(await exists(path.join(homeDir, ".claude/.hookwire-backups"))).toBe(false);
    });
  });

  it("backs up existing config files before adding managed Hookwire config", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      await writeJson(claudeConfigPath, {
        existing: true,
        nested: { keep: "value" }
      });

      const result = await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0]).toMatchObject({
        action: "updated",
        agent: "claude",
        backupCreated: true
      });
      const backupPath = result.agents[0].backupPath;
      expect(backupPath).toEqual(
        path.join(homeDir, ".claude/.hookwire-backups/settings.json.2026-06-21T15-30-00-000Z.bak")
      );
      await expect(readJson(backupPath)).resolves.toEqual({
        existing: true,
        nested: { keep: "value" }
      });
      await expect(readJson(claudeConfigPath)).resolves.toMatchObject({
        existing: true,
        nested: { keep: "value" },
        hookwire: expectedHookwireConfig({
          agent: "claude",
          installedAt: fixedNow,
          projectDir
        })
      });
    });
  });

  it("preserves existing config file permissions when updating", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      await writeJson(claudeConfigPath, { existing: true });
      if (process.platform !== "win32") {
        await chmod(claudeConfigPath, 0o664);
        expect(await mode(claudeConfigPath)).toBe(0o664);
      }

      const result = await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      expect(result.agents[0].action).toBe("updated");
      if (process.platform !== "win32") {
        expect(await mode(claudeConfigPath)).toBe(0o664);
      }
    });
  });

  it("does not overwrite an existing backup path when timestamps collide", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      const firstBackupPath = path.join(
        homeDir,
        ".claude/.hookwire-backups/settings.json.2026-06-21T15-30-00-000Z.bak"
      );
      await writeJson(claudeConfigPath, { existing: true });
      await mkdir(path.dirname(firstBackupPath), { recursive: true });
      await writeFile(firstBackupPath, "sentinel", "utf8");

      const result = await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      expect(result.agents[0]).toMatchObject({
        action: "updated",
        backupCreated: true,
        backupPath: path.join(
          homeDir,
          ".claude/.hookwire-backups/settings.json.2026-06-21T15-30-00-000Z.1.bak"
        )
      });
      expect(await readFile(firstBackupPath, "utf8")).toBe("sentinel");
      await expect(readJson(result.agents[0].backupPath)).resolves.toEqual({ existing: true });
    });
  });

  it("creates missing config files safely without backup files", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const result = await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["codex"]
      });

      const codexConfigPath = path.join(homeDir, ".codex/config.json");
      expect(result.agents[0]).toMatchObject({
        action: "created",
        agent: "codex",
        backupCreated: false,
        backupPath: null,
        configPath: codexConfigPath
      });
      await expect(readJson(codexConfigPath)).resolves.toEqual({
        hookwire: expectedHookwireConfig({
          agent: "codex",
          installedAt: fixedNow,
          projectDir
        })
      });
      if (process.platform !== "win32") {
        expect(await mode(codexConfigPath)).toBe(0o600);
      }
    });
  });

  it("installs all supported agents when no explicit agent list is provided", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const result = await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir
      });

      expect(result.agents.map((agent) => [agent.agent, agent.action])).toEqual([
        ["claude", "created"],
        ["codex", "created"],
        ["openclaw", "created"]
      ]);
      expect(await exists(path.join(homeDir, ".claude/settings.json"))).toBe(true);
      expect(await exists(path.join(homeDir, ".codex/config.json"))).toBe(true);
      expect(await exists(path.join(homeDir, ".openclaw/config.json"))).toBe(true);
    });
  });

  it("doctor reports healthy, missing, drifted, and stale hook configuration", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude", "codex", "openclaw"]
      });

      const codexConfigPath = path.join(homeDir, ".codex/config.json");
      const codexConfig = await readJson(codexConfigPath);
      codexConfig.hookwire.adapterCommand = "hookwire relay --agent codex --project /wrong/project";
      await writeJson(codexConfigPath, codexConfig);

      const openClawConfigPath = path.join(homeDir, ".openclaw/config.json");
      const openClawConfig = await readJson(openClawConfigPath);
      openClawConfig.hookwire.version = CURRENT_HOOKWIRE_CONFIG_VERSION - 1;
      await writeJson(openClawConfigPath, openClawConfig);

      await rm(path.join(homeDir, ".claude/settings.json"));

      const doctor = await runDoctor({ homeDir, projectDir });

      expect(doctor.agents.map((agent) => [agent.agent, agent.status])).toEqual([
        ["claude", "missing_config"],
        ["codex", "drifted"],
        ["openclaw", "stale"]
      ]);
      expect(doctor.ok).toBe(false);
      expect(doctor.agents[1].expected.adapterCommand).toBe(
        `hookwire relay --agent codex --project ${projectDir}`
      );
      expect(doctor.agents[1].actual.adapterCommand).toBe("hookwire relay --agent codex --project /wrong/project");
    });
  });

  it("doctor reports invalid JSON and missing Hookwire hook config", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      await mkdir(path.dirname(claudeConfigPath), { recursive: true });
      await writeFile(claudeConfigPath, "{not json", "utf8");
      await writeJson(path.join(homeDir, ".codex/config.json"), { existing: true });

      const doctor = await runDoctor({ homeDir, projectDir });

      expect(doctor.ok).toBe(false);
      expect(doctor.agents.map((agent) => [agent.agent, agent.status])).toEqual([
        ["claude", "invalid_config"],
        ["codex", "missing_hook"],
        ["openclaw", "missing_config"]
      ]);
      expect(doctor.agents[0].error).toContain("valid JSON");
      expect(doctor.agents[1].actual).toBe(null);
    });
  });

  it("doctor reports a healthy fixture after init", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude", "codex", "openclaw"]
      });

      const doctor = await runDoctor({ homeDir, projectDir });

      expect(doctor.ok).toBe(true);
      expect(doctor.agents.map((agent) => [agent.agent, agent.status])).toEqual([
        ["claude", "healthy"],
        ["codex", "healthy"],
        ["openclaw", "healthy"]
      ]);
    });
  });

  it("refuses to overwrite invalid JSON and leaves the original file untouched", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const configPath = path.join(homeDir, ".claude/settings.json");
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, "{not json", "utf8");

      const result = await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      expect(result.agents[0]).toMatchObject({
        action: "skipped_invalid",
        agent: "claude",
        backupCreated: false
      });
      expect(result.agents[0].error).toContain("valid JSON");
      expect(await readFile(configPath, "utf8")).toBe("{not json");
      expect(await exists(path.join(homeDir, ".claude/.hookwire-backups"))).toBe(false);
    });
  });

  it("refuses to modify config files whose JSON root is not an object", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const configPath = path.join(homeDir, ".claude/settings.json");
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, "[]\n", "utf8");

      const result = await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      expect(result.agents[0]).toMatchObject({
        action: "skipped_invalid",
        backupCreated: false
      });
      expect(result.agents[0].error).toContain("JSON object");
      expect(await readFile(configPath, "utf8")).toBe("[]\n");
    });
  });

  it("rejects unsupported or blank agent names before writing files", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await expect(
        runInit({
          homeDir,
          projectDir,
          selectedAgents: ["cursor"]
        })
      ).rejects.toThrow('Unsupported agent "cursor"');
      await expect(
        runInit({
          homeDir,
          projectDir,
          selectedAgents: [" "]
        })
      ).rejects.toThrow("Agent must be a non-empty string");

      expect(await exists(path.join(homeDir, ".claude/settings.json"))).toBe(false);
      expect(
        expectedHookwireConfig({
          agent: "CLAUDE",
          installedAt: "2026-06-21T15:30:00.000Z",
          projectDir
        }).agent
      ).toBe("claude");
    });
  });
});
