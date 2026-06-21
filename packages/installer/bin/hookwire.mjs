#!/usr/bin/env node

import { runDoctor, runInit, supportedAgents } from "../src/installer.mjs";

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

  throw new Error(`Unknown command "${command}".`);
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    homeDir: undefined,
    json: false,
    projectDir: undefined,
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
    if (arg === "--agent" || arg === "--agents") {
      const value = readValue(args, (index += 1), arg);
      options.selectedAgents.push(...value.split(",").map((agent) => agent.trim()).filter(Boolean));
      continue;
    }
    throw new Error(`Unknown option "${arg}".`);
  }

  return options;
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
    if (agent.error) {
      lines.push(`  error: ${agent.error}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function printHelp() {
  process.stdout.write(`Hookwire installer

Usage:
  hookwire init [--dry-run] [--home <dir>] [--project <dir>] [--agent <agent[,agent]>] [--json]
  hookwire doctor [--home <dir>] [--project <dir>] [--json]

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
