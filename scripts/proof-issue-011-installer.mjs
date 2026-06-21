import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../packages/installer/src/installer.mjs";

const fixedNow = new Date("2026-06-21T15:30:00.000Z");
const outputPath = new URL("../docs/reviews/2026-06-21-issue-011-installer-proof.json", import.meta.url);
const cliPath = fileURLToPath(new URL("../packages/installer/bin/hookwire.mjs", import.meta.url));

async function main() {
  const fixture = await mkdtemp(path.join(tmpdir(), "hookwire-installer-proof-"));

  try {
    const homeDir = path.join(fixture, "home");
    const projectDir = path.join(fixture, "project");
    await mkdir(homeDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });

    const claudeConfigPath = path.join(homeDir, ".claude/settings.json");
    await writeJson(claudeConfigPath, {
      existing: true,
      theme: "dark"
    });
    const claudeBeforeText = await readFile(claudeConfigPath, "utf8");
    const beforeTree = await listTree(fixture);

    const dryRun = await runInit({
      dryRun: true,
      homeDir,
      now: fixedNow,
      projectDir,
      selectedAgents: ["claude", "codex"]
    });
    const afterDryRunTree = await listTree(fixture);
    const dryRunFileUnchanged = (await readFile(claudeConfigPath, "utf8")) === claudeBeforeText;

    const init = await runInit({
      dryRun: false,
      homeDir,
      now: fixedNow,
      projectDir,
      selectedAgents: ["claude", "codex", "openclaw"]
    });
    const claudeAfterText = await readFile(claudeConfigPath, "utf8");
    const afterInitTree = await listTree(fixture);

    const healthyDoctor = await runCli(["doctor", "--home", homeDir, "--project", projectDir]);

    const codexConfigPath = path.join(homeDir, ".codex/config.json");
    const codexConfig = JSON.parse(await readFile(codexConfigPath, "utf8"));
    codexConfig.hookwire.adapterCommand = "hookwire relay --agent codex --project /wrong/project";
    await writeJson(codexConfigPath, codexConfig);
    const driftedDoctor = await runCli(["doctor", "--home", homeDir, "--project", projectDir]);

    const backupFiles = afterInitTree.filter((entry) => entry.path.includes(".hookwire-backups"));
    const proof = {
      issue: "011-installer-framework",
      generatedAt: new Date().toISOString(),
      fixture: {
        homeDir,
        projectDir,
        root: fixture
      },
      dryRun: {
        actions: dryRun.agents.map(({ action, agent, backupPath, configPath }) => ({
          action,
          agent,
          backupPath,
          configPath
        })),
        afterTree: afterDryRunTree,
        beforeTree,
        fileUnchanged: dryRunFileUnchanged
      },
      init: {
        actions: init.agents.map(({ action, agent, backupCreated, backupPath, configPath }) => ({
          action,
          agent,
          backupCreated,
          backupPath,
          configPath
        })),
        afterTree: afterInitTree,
        backupFiles,
        claudeConfigDiff: unifiedDiff("before/.claude/settings.json", "after/.claude/settings.json", claudeBeforeText, claudeAfterText)
      },
      doctor: {
        drifted: driftedDoctor,
        healthy: healthyDoctor
      }
    };

    assertProof(proof);
    await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
    process.stdout.write(
      `${JSON.stringify(
        {
          backupFiles: backupFiles.map((entry) => entry.path),
          driftedDoctorExitCode: driftedDoctor.exitCode,
          dryRunActions: proof.dryRun.actions.map(({ agent, action }) => [agent, action]),
          healthyDoctorExitCode: healthyDoctor.exitCode,
          initActions: proof.init.actions.map(({ agent, action }) => [agent, action]),
          outputPath: fileURLToPath(outputPath)
        },
        null,
        2
      )}\n`
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

function assertProof(proof) {
  if (!proof.dryRun.fileUnchanged) {
    throw new Error("Dry-run modified the Claude config file.");
  }
  if (proof.dryRun.afterTree.some((entry) => entry.path.includes(".hookwire-backups"))) {
    throw new Error("Dry-run created a backup directory.");
  }
  if (!proof.init.backupFiles.some((entry) => entry.path.includes(".claude/.hookwire-backups/settings.json"))) {
    throw new Error("Installer did not create the expected Claude backup file.");
  }
  if (proof.doctor.healthy.exitCode !== 0 || !proof.doctor.healthy.stdout.includes("healthy")) {
    throw new Error("Healthy doctor command did not report success.");
  }
  if (proof.doctor.drifted.exitCode !== 2 || !proof.doctor.drifted.stdout.includes("codex: drifted")) {
    throw new Error("Drifted doctor command did not report Codex drift.");
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
      entries.push({
        bytes: fileStat.size,
        kind: "file",
        path: relativePath
      });
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

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stderr, stdout });
    });
  });
}

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}

await main();
