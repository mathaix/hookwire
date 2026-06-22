import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CURRENT_HOOKWIRE_CONFIG_VERSION,
  detectAgents,
  expectedHookwireConfig,
  runDoctor,
  runInit,
  runUninstall
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
      expect(result.patchMode).toBe("auto");
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

  it("supports manual patch mode without modifying config files or creating backups", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      await writeJson(claudeConfigPath, { existing: true });
      const before = await readFile(claudeConfigPath, "utf8");

      const result = await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        patchMode: "manual",
        projectDir,
        selectedAgents: ["claude", "codex"]
      });

      expect(result.patchMode).toBe("manual");
      expect(result.agents.map((agent) => [agent.agent, agent.action])).toEqual([
        ["claude", "manual_update"],
        ["codex", "manual_create"]
      ]);
      expect(result.agents[0].manualInstructions).toContain("Manual patch mode selected");
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
        hookwire: expect.objectContaining(expectedHookwireConfig({
          agent: "codex",
          installedAt: fixedNow,
          projectDir
        }))
      });
      expect((await readJson(codexConfigPath)).hookwire.integrity).toMatchObject({
        algorithm: "sha256",
        value: expect.stringMatching(/^[0-9a-f]{64}$/)
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

  it("doctor reports tampered when managed hook integrity does not match", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      const claudeConfig = await readJson(claudeConfigPath);
      claudeConfig.hooks.PreToolUse[0].hooks[0].args = [
        "hook",
        "--agent",
        "claude",
        "--event",
        "PreToolUse",
        "--project",
        "/tampered/project"
      ];
      await writeJson(claudeConfigPath, claudeConfig);

      const doctor = await runDoctor({ homeDir, projectDir });

      expect(doctor.ok).toBe(false);
      expect(doctor.agents.map((agent) => [agent.agent, agent.status])).toEqual([
        ["claude", "tampered"],
        ["codex", "missing_config"],
        ["openclaw", "missing_config"]
      ]);
      expect(doctor.agents[0].actual.integrityCheck.status).toBe("tampered");
    });
  });

  it("doctor ignores non-managed Claude hookwire commands when checking integrity", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      const claudeConfig = await readJson(claudeConfigPath);
      claudeConfig.hooks.PreToolUse.push({
        hooks: [
          {
            args: ["hook", "--event", "PreToolUse", "--agent", "claude", "--project", projectDir],
            command: "hookwire",
            type: "command"
          }
        ],
        matcher: "Bash"
      });
      await writeJson(claudeConfigPath, claudeConfig);

      const doctor = await runDoctor({ homeDir, projectDir });
      const claude = doctor.agents.find((agent) => agent.agent === "claude");

      expect(claude.status).toBe("healthy");
      expect(claude.actual.integrityCheck.status).toBe("verified");
    });
  });

  it("doctor reports missing integrity separately from ordinary drift", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await writeJson(path.join(homeDir, ".codex/config.json"), {
        hookwire: expectedHookwireConfig({
          agent: "codex",
          installedAt: fixedNow,
          projectDir
        })
      });

      const doctor = await runDoctor({ homeDir, projectDir });
      const codex = doctor.agents.find((agent) => agent.agent === "codex");

      expect(codex).toMatchObject({
        status: "tampered"
      });
      expect(codex.actual.integrityCheck.status).toBe("missing_integrity");
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
      expect(doctor.agents[0].actual.integrityCheck.status).toBe("verified");
    });
  });

  it("uninstall removes Hookwire-managed config and Claude hooks while preserving user hook groups", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
      await writeJson(claudeConfigPath, {
        hooks: {
          PostToolUse: [
            {
              hooks: [{ command: "echo custom", type: "command" }],
              matcher: "Write"
            }
          ]
        },
        theme: "dark"
      });
      await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      const result = await runUninstall({
        dryRun: false,
        homeDir,
        now: new Date("2026-06-21T16:30:00.000Z"),
        projectDir,
        selectedAgents: ["claude"]
      });

      expect(result.agents[0]).toMatchObject({
        action: "removed",
        backupCreated: true
      });
      await expect(readJson(claudeConfigPath)).resolves.toEqual({
        hooks: {
          PostToolUse: [
            {
              hooks: [{ command: "echo custom", type: "command" }],
              matcher: "Write"
            }
          ]
        },
        theme: "dark"
      });
      await expect(readJson(result.agents[0].backupPath)).resolves.toHaveProperty("hookwire");
    });
  });

  it("uninstall supports dry-run, manual mode, missing config, invalid JSON, and unchanged config", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["codex"]
      });
      const codexConfigPath = path.join(homeDir, ".codex/config.json");
      const before = await readFile(codexConfigPath, "utf8");

      const dryRun = await runUninstall({
        dryRun: true,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["codex"]
      });
      expect(dryRun.agents[0]).toMatchObject({
        action: "would_remove",
        backupCreated: false
      });
      expect(await readFile(codexConfigPath, "utf8")).toBe(before);

      const manual = await runUninstall({
        homeDir,
        now: fixedNow,
        patchMode: "manual",
        projectDir,
        selectedAgents: ["codex"]
      });
      expect(manual.agents[0]).toMatchObject({
        action: "manual_remove",
        backupCreated: false
      });
      expect(manual.agents[0].manualInstructions).toContain("Manual patch mode selected");
      expect(await readFile(codexConfigPath, "utf8")).toBe(before);

      const missing = await runUninstall({
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["openclaw"]
      });
      expect(missing.agents[0].action).toBe("missing");

      await writeJson(path.join(homeDir, ".openclaw/config.json"), { existing: true });
      await mkdir(path.join(homeDir, ".claude"), { recursive: true });
      await writeFile(path.join(homeDir, ".claude/settings.json"), "{not json", "utf8");

      const mixed = await runUninstall({
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude", "openclaw"]
      });
      expect(mixed.agents.map((agent) => [agent.agent, agent.action])).toEqual([
        ["claude", "skipped_invalid"],
        ["openclaw", "unchanged"]
      ]);
    });
  });

  it("uninstall removes empty Claude hook containers when no user hooks remain", async () => {
    await withFixture(async ({ homeDir, projectDir }) => {
      await runInit({
        dryRun: false,
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      const result = await runUninstall({
        homeDir,
        now: fixedNow,
        projectDir,
        selectedAgents: ["claude"]
      });

      expect(result.agents[0].action).toBe("removed");
      await expect(readJson(path.join(homeDir, ".claude/settings.json"))).resolves.toEqual({});
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
          patchMode: "ask",
          projectDir,
          selectedAgents: ["claude"]
        })
      ).rejects.toThrow('Unsupported patch mode "ask"');
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
