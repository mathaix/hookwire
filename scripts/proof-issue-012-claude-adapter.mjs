import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  claudeDecisionOutput,
  expectedClaudeHookCommand,
  normalizeClaudeHookPayload,
  runClaudeHook
} from "../packages/agent-adapters/src/claude.mjs";
import { runDoctor, runInit } from "../packages/installer/src/installer.mjs";

const fixedNow = new Date("2026-06-21T16:30:00.000Z");
const outputPath = new URL("../docs/reviews/2026-06-21-issue-012-claude-adapter-proof.json", import.meta.url);
const cliPath = fileURLToPath(new URL("../packages/installer/bin/hookwire.mjs", import.meta.url));

const fixtures = {
  permissionRequest: {
    cwd: "/workspace/hookwire",
    hook_event_name: "PermissionRequest",
    permission_mode: "default",
    permission_suggestions: [
      {
        behavior: "allow",
        destination: "localSettings",
        rules: [{ ruleContent: "npm test", toolName: "Bash" }],
        type: "addRules"
      }
    ],
    session_id: "sess-proof-claude",
    tool_input: { command: "npm test" },
    tool_name: "Bash",
    transcript_path: "/tmp/hookwire-claude-transcript.jsonl"
  },
  postToolUse: {
    cwd: "/workspace/hookwire",
    duration_ms: 37,
    hook_event_name: "PostToolUse",
    permission_mode: "default",
    session_id: "sess-proof-claude",
    tool_input: { file_path: "/workspace/hookwire/README.md" },
    tool_name: "Read",
    tool_response: { filePath: "/workspace/hookwire/README.md", success: true },
    tool_use_id: "toolu_post_proof",
    transcript_path: "/tmp/hookwire-claude-transcript.jsonl"
  },
  preToolUse: {
    cwd: "/workspace/hookwire",
    hook_event_name: "PreToolUse",
    permission_mode: "default",
    session_id: "sess-proof-claude",
    tool_input: { command: "npm test", description: "Run tests" },
    tool_name: "Bash",
    tool_use_id: "toolu_pre_proof",
    transcript_path: "/tmp/hookwire-claude-transcript.jsonl"
  }
};

async function main() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "hookwire-claude-proof-"));
  try {
    const homeDir = path.join(fixtureRoot, "home");
    const projectDir = path.join(fixtureRoot, "project with spaces");
    const settingsPath = path.join(homeDir, ".claude/settings.json");
    await mkdir(projectDir, { recursive: true });
    await writeJson(settingsPath, {
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

    const beforeSettings = await readFile(settingsPath, "utf8");
    const beforeTree = await listTree(fixtureRoot);
    const init = await runInit({
      dryRun: false,
      homeDir,
      now: fixedNow,
      projectDir,
      selectedAgents: ["claude"]
    });
    const afterSettings = await readFile(settingsPath, "utf8");
    const afterTree = await listTree(fixtureRoot);
    const healthyDoctor = await runDoctor({ homeDir, projectDir });

    const settings = JSON.parse(afterSettings);
    const cliDeny = await runCli(
      ["hook", "--agent", "claude", "--event", "PreToolUse", "--decision", "deny", "--reason", "Policy"],
      JSON.stringify(fixtures.preToolUse)
    );
    const malformed = await runClaudeHook({
      agent: "claude",
      eventName: "PreToolUse",
      input: "{not json"
    });

    settings.hooks.PreToolUse[0].hooks[0].args = [
      "hook",
      "--agent",
      "claude",
      "--event",
      "PreToolUse",
      "--project",
      "/wrong/project"
    ];
    await writeJson(settingsPath, settings);
    const driftedDoctor = await runDoctor({ homeDir, projectDir });

    const proof = {
      issue: "012-claude-adapter",
      generatedAt: new Date().toISOString(),
      fixture: {
        homeDir,
        projectDir,
        root: fixtureRoot
      },
      sanitizedFixtures: fixtures,
      normalizedEvents: {
        permissionRequest: normalizeClaudeHookPayload(fixtures.permissionRequest, { eventName: "PermissionRequest" }),
        postToolUse: normalizeClaudeHookPayload(fixtures.postToolUse, { eventName: "PostToolUse" }),
        preToolUse: normalizeClaudeHookPayload(fixtures.preToolUse, { eventName: "PreToolUse" })
      },
      goldenOutputs: {
        ask: claudeDecisionOutput("PreToolUse", { decision: "ask", reason: "Needs review" }),
        allow: claudeDecisionOutput("PreToolUse", { decision: "allow", reason: "Safe command" }),
        deny: claudeDecisionOutput("PreToolUse", { decision: "deny", reason: "Policy" }),
        malformedPreToolUse: JSON.parse(malformed.stdout),
        permissionAllow: claudeDecisionOutput("PermissionRequest", {
          decision: "allow",
          reason: "Approved",
          updatedInput: { command: "npm run lint" },
          updatedPermissions: fixtures.permissionRequest.permission_suggestions
        }),
        postToolUseBlock: claudeDecisionOutput("PostToolUse", { decision: "deny", reason: "Blocked after audit" })
      },
      installer: {
        actions: init.agents,
        afterTree,
        beforeTree,
        claudeConfigDiff: unifiedDiff("before/.claude/settings.json", "after/.claude/settings.json", beforeSettings, afterSettings),
        expectedPreToolUseCommand: expectedClaudeHookCommand({ eventName: "PreToolUse", projectDir })
      },
      cli: {
        deny: cliDeny
      },
      doctor: {
        drifted: driftedDoctor.agents.find((agent) => agent.agent === "claude"),
        healthy: healthyDoctor.agents.find((agent) => agent.agent === "claude")
      }
    };

    assertProof(proof);
    await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
    process.stdout.write(
      `${JSON.stringify(
        {
          cliDenyExitCode: cliDeny.exitCode,
          doctorDriftedStatus: proof.doctor.drifted.status,
          doctorHealthyStatus: proof.doctor.healthy.status,
          initAction: init.agents[0].action,
          outputPath: fileURLToPath(outputPath)
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
  if (proof.installer.actions[0].action !== "updated") {
    throw new Error("Claude installer did not update existing settings.");
  }
  if (!proof.installer.actions[0].backupCreated) {
    throw new Error("Claude installer did not back up existing settings.");
  }
  if (proof.doctor.healthy.status !== "healthy") {
    throw new Error("Claude doctor did not report healthy after install.");
  }
  if (proof.doctor.drifted.status !== "drifted") {
    throw new Error("Claude doctor did not report drift after hook mutation.");
  }
  if (proof.cli.deny.exitCode !== 0 || JSON.parse(proof.cli.deny.stdout).hookSpecificOutput.permissionDecision !== "deny") {
    throw new Error("Claude hook CLI did not emit expected deny output.");
  }
  if (proof.goldenOutputs.malformedPreToolUse.hookSpecificOutput.permissionDecision !== "deny") {
    throw new Error("Malformed PreToolUse payload did not fail closed.");
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

function runCli(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"]
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
    child.stdin.end(input);
  });
}

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}

await main();
