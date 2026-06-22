#!/usr/bin/env node

import { runClaudeHook } from "../../agent-adapters/src/claude.mjs";
import { runDoctor, runInit, runUninstall, supportedAgents } from "../src/installer.mjs";

async function main(argv) {
  const [command, ...args] = argv;
  const options = parseArgs(args);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "init") {
    const result = await runInit({
      dryRun: options.dryRun,
      homeDir: options.homeDir,
      patchMode: options.patchMode,
      projectDir: options.projectDir,
      selectedAgents: options.selectedAgents
    });
    printResult(result, options.json, formatInitText);
    return 0;
  }

  if (command === "doctor") {
    const result = await runDoctor({
      homeDir: options.homeDir,
      projectDir: options.projectDir
    });
    printResult(result, options.json, formatDoctorText);
    return result.ok ? 0 : 2;
  }

  if (command === "uninstall") {
    const result = await runUninstall({
      dryRun: options.dryRun,
      homeDir: options.homeDir,
      patchMode: options.patchMode,
      projectDir: options.projectDir,
      selectedAgents: options.selectedAgents
    });
    printResult(result, options.json, formatUninstallText);
    return 0;
  }

  if (command === "hook") {
    const result = await runClaudeHook({
      agent: options.agent,
      decision: options.decision,
      eventName: options.eventName,
      input: await readStdin(),
      reason: options.reason
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }

  throw new Error(`Unknown command "${command}".`);
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    homeDir: undefined,
    json: false,
    projectDir: undefined,
    reason: undefined,
    selectedAgents: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--home") {
      options.homeDir = readValue(args, (index += 1), "--home");
      continue;
    }
    if (arg === "--project") {
      options.projectDir = readValue(args, (index += 1), "--project");
      continue;
    }
    if (arg === "--patch-mode") {
      options.patchMode = readValue(args, (index += 1), "--patch-mode");
      continue;
    }
    if (arg === "--no-patch") {
      options.patchMode = "manual";
      continue;
    }
    if (arg === "--agent") {
      const value = readValue(args, (index += 1), "--agent");
      options.agent = value;
      options.selectedAgents.push(...value.split(",").map((agent) => agent.trim()).filter(Boolean));
      continue;
    }
    if (arg === "--agents") {
      const value = readValue(args, (index += 1), "--agents");
      options.selectedAgents.push(...value.split(",").map((agent) => agent.trim()).filter(Boolean));
      continue;
    }
    if (arg === "--event") {
      options.eventName = readValue(args, (index += 1), "--event");
      continue;
    }
    if (arg === "--decision") {
      options.decision = readValue(args, (index += 1), "--decision");
      continue;
    }
    if (arg === "--reason") {
      options.reason = readValue(args, (index += 1), "--reason");
      continue;
    }
    throw new Error(`Unknown option "${arg}".`);
  }

  return options;
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString();
  }
  return input;
}

function readValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function printResult(result, json, formatter) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(formatter(result));
}

function formatInitText(result) {
  const lines = [
    `Hookwire init ${result.dryRun ? "(dry run)" : ""}`.trim(),
    `Home: ${result.homeDir}`,
    `Patch mode: ${result.patchMode}`,
    `Project: ${result.projectDir}`,
    ""
  ];

  for (const agent of result.agents) {
    lines.push(`${agent.agent}: ${agent.action} ${agent.configPath}`);
    if (agent.backupPath) {
      lines.push(`  backup: ${agent.backupPath}`);
    }
    if (agent.error) {
      lines.push(`  error: ${agent.error}`);
    }
    if (agent.manualInstructions) {
      lines.push(`  manual: ${agent.manualInstructions}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatUninstallText(result) {
  const lines = [
    `Hookwire uninstall ${result.dryRun ? "(dry run)" : ""}`.trim(),
    `Home: ${result.homeDir}`,
    `Patch mode: ${result.patchMode}`,
    `Project: ${result.projectDir}`,
    ""
  ];

  for (const agent of result.agents) {
    lines.push(`${agent.agent}: ${agent.action} ${agent.configPath}`);
    if (agent.backupPath) {
      lines.push(`  backup: ${agent.backupPath}`);
    }
    if (agent.error) {
      lines.push(`  error: ${agent.error}`);
    }
    if (agent.manualInstructions) {
      lines.push(`  manual: ${agent.manualInstructions}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatDoctorText(result) {
  const lines = [
    `Hookwire doctor ${result.ok ? "healthy" : "needs attention"}`,
    `Home: ${result.homeDir}`,
    `Project: ${result.projectDir}`,
    ""
  ];

  for (const agent of result.agents) {
    lines.push(`${agent.agent}: ${agent.status} ${agent.configPath}`);
    if (agent.status === "drifted") {
      lines.push(`  expected: ${agent.expected.adapterCommand}`);
      lines.push(`  actual: ${agent.actual?.adapterCommand ?? "missing"}`);
    }
    if (agent.status === "tampered") {
      lines.push(`  integrity: ${agent.actual?.integrityCheck?.status ?? "unknown"}`);
    }
    if (agent.error) {
      lines.push(`  error: ${agent.error}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function printHelp() {
  process.stdout.write(`Hookwire installer

Usage:
  hookwire init [--dry-run] [--no-patch|--patch-mode auto|manual] [--home <dir>] [--project <dir>] [--agent <agent[,agent]>] [--json]
  hookwire doctor [--home <dir>] [--project <dir>] [--json]
  hookwire uninstall [--dry-run] [--no-patch|--patch-mode auto|manual] [--home <dir>] [--project <dir>] [--agent <agent[,agent]>] [--json]
  hookwire hook --agent claude --event <event> [--decision <allow|deny|ask>] [--reason <text>]

Supported agents: ${supportedAgents().join(", ")}
`);
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
