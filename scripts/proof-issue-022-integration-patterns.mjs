import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDoctor, runInit, runUninstall } from "../packages/installer/src/installer.mjs";

const fixedNow = new Date("2026-06-22T13:30:00.000Z");
const uninstallNow = new Date("2026-06-22T14:30:00.000Z");
const outputPath = new URL("../docs/reviews/2026-06-22-issue-022-integration-patterns-proof.json", import.meta.url);

async function main() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "hookwire-integration-patterns-proof-"));
  try {
    const homeDir = path.join(fixtureRoot, "home");
    const projectDir = path.join(fixtureRoot, "project");
    const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
    await mkdir(projectDir, { recursive: true });
    await writeJson(claudeConfigPath, {
      hooks: {
        PostToolUse: [
          {
            hooks: [{ command: "echo existing", type: "command" }],
            matcher: "Write"
          }
        ]
      },
      theme: "dark"
    });

    const beforeText = await readFile(claudeConfigPath, "utf8");
    const beforeTree = await listTree(fixtureRoot);
    const manualInit = await runInit({
      homeDir,
      now: fixedNow,
      patchMode: "manual",
      projectDir,
      selectedAgents: ["claude", "codex"]
    });
    const afterManualText = await readFile(claudeConfigPath, "utf8");
    const afterManualTree = await listTree(fixtureRoot);

    const init = await runInit({
      homeDir,
      now: fixedNow,
      projectDir,
      selectedAgents: ["claude", "codex", "openclaw"]
    });
    const afterInitText = await readFile(claudeConfigPath, "utf8");
    const healthyDoctor = await runDoctor({ homeDir, projectDir });

    const tamperedConfig = JSON.parse(await readFile(claudeConfigPath, "utf8"));
    tamperedConfig.hooks.PreToolUse[0].hooks[0].args = [
      "hook",
      "--agent",
      "claude",
      "--event",
      "PreToolUse",
      "--project",
      "/tampered/project"
    ];
    await writeJson(claudeConfigPath, tamperedConfig);
    const tamperedDoctor = await runDoctor({ homeDir, projectDir });

    await writeFile(claudeConfigPath, afterInitText, "utf8");
    const uninstall = await runUninstall({
      homeDir,
      now: uninstallNow,
      projectDir,
      selectedAgents: ["claude"]
    });
    const afterUninstallText = await readFile(claudeConfigPath, "utf8");
    const afterUninstallTree = await listTree(fixtureRoot);

    const proof = {
      issue: "022-integration-patterns",
      generatedAt: new Date().toISOString(),
      fixture: {
        homeDir,
        projectDir,
        root: fixtureRoot
      },
      manualPatchMode: {
        actions: manualInit.agents.map(({ action, agent, manualInstructions }) => ({ action, agent, manualInstructions })),
        afterTree: afterManualTree,
        beforeTree,
        fileUnchanged: afterManualText === beforeText
      },
      init: {
        actions: init.agents.map(({ action, agent, backupCreated, configPath, expected }) => ({
          action,
          agent,
          backupCreated,
          configPath,
          failureMode: expected.failureMode,
          integrationTier: expected.integrationTier,
          integrity: expected.integrity
        })),
        claudeConfigDiff: unifiedDiff("before/.claude/settings.json", "after/.claude/settings.json", beforeText, afterInitText)
      },
      doctor: {
        healthy: healthyDoctor.agents.map(({ agent, actual, status }) => ({
          agent,
          integrityStatus: actual?.integrityCheck?.status ?? null,
          status
        })),
        tampered: tamperedDoctor.agents.map(({ agent, actual, status }) => ({
          agent,
          integrityStatus: actual?.integrityCheck?.status ?? null,
          status
        }))
      },
      uninstall: {
        actions: uninstall.agents.map(({ action, agent, backupCreated, backupPath, configPath }) => ({
          action,
          agent,
          backupCreated,
          backupPath,
          configPath
        })),
        afterTree: afterUninstallTree,
        claudeConfigDiff: unifiedDiff("installed/.claude/settings.json", "uninstalled/.claude/settings.json", afterInitText, afterUninstallText)
      }
    };

    assertProof(proof);
    await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
    process.stdout.write(
      `${JSON.stringify(
        {
          healthyStatuses: proof.doctor.healthy.map(({ agent, status }) => [agent, status]),
          manualActions: proof.manualPatchMode.actions.map(({ agent, action }) => [agent, action]),
          outputPath: fileURLToPath(outputPath),
          tamperedStatuses: proof.doctor.tampered.map(({ agent, status }) => [agent, status]),
          uninstallActions: proof.uninstall.actions.map(({ agent, action }) => [agent, action])
        },
        null,
        2
      )}\n`
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function assertProof(proof) {
  if (!proof.manualPatchMode.fileUnchanged) {
    throw new Error("Manual patch mode modified config.");
  }
  if (proof.manualPatchMode.afterTree.some((entry) => entry.path.includes(".hookwire-backups"))) {
    throw new Error("Manual patch mode created backups.");
  }
  if (!proof.init.actions.every((action) => action.integrity?.algorithm === "sha256")) {
    throw new Error("Installed agent configs did not include SHA-256 integrity metadata.");
  }
  if (!proof.doctor.healthy.every((agent) => agent.status === "healthy" && agent.integrityStatus === "verified")) {
    throw new Error("Doctor did not verify healthy integrity state.");
  }
  if (!proof.doctor.tampered.some((agent) => agent.agent === "claude" && agent.status === "tampered")) {
    throw new Error("Doctor did not report Claude hook tampering.");
  }
  if (proof.uninstall.actions[0].action !== "removed" || !proof.uninstall.actions[0].backupCreated) {
    throw new Error("Uninstall did not remove Hookwire config with a backup.");
  }
  if (!proof.uninstall.claudeConfigDiff.includes('-  "hookwire"')) {
    throw new Error("Uninstall diff did not remove Hookwire managed config.");
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listTree(root) {
  const entries = [];
  await visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));

  async function visit(dir) {
    const dirEntries = await readdir(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = toPosix(path.relative(root, fullPath));
      if (entry.isDirectory()) {
        entries.push({ kind: "dir", path: relativePath });
        await visit(fullPath);
        continue;
      }
      const fileStat = await stat(fullPath);
      entries.push({ bytes: fileStat.size, kind: "file", path: relativePath });
    }
  }
}

function unifiedDiff(beforeLabel, afterLabel, beforeText, afterText) {
  if (beforeText === afterText) {
    return "";
  }

  const beforeLines = beforeText.trimEnd().split("\n");
  const afterLines = afterText.trimEnd().split("\n");
  return [
    `--- ${beforeLabel}`,
    `+++ ${afterLabel}`,
    "@@",
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ].join("\n");
}

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}

await main();
