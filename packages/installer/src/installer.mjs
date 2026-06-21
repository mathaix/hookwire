import { constants as fsConstants } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  claudeHooksMatch,
  expectedClaudeHooks,
  mergeClaudeHooks
} from "../../agent-adapters/src/claude.mjs";

export const CURRENT_HOOKWIRE_CONFIG_VERSION = 1;

export const AGENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    agent: "claude",
    configSegments: [".claude", "settings.json"],
    displayName: "Claude Code"
  }),
  Object.freeze({
    agent: "codex",
    configSegments: [".codex", "config.json"],
    displayName: "Codex"
  }),
  Object.freeze({
    agent: "openclaw",
    configSegments: [".openclaw", "config.json"],
    displayName: "OpenClaw"
  })
]);

const AGENT_BY_NAME = new Map(AGENT_DEFINITIONS.map((definition) => [definition.agent, definition]));

export function supportedAgents() {
  return AGENT_DEFINITIONS.map((definition) => definition.agent);
}

export function expectedHookwireConfig({ agent, installedAt = new Date(), projectDir }) {
  const normalizedAgent = normalizeAgent(agent);
  const normalizedProjectDir = normalizeProjectDir(projectDir);
  return {
    adapterCommand: `hookwire relay --agent ${normalizedAgent} --project ${normalizedProjectDir}`,
    agent: normalizedAgent,
    installedAt: installedAt instanceof Date ? installedAt.toISOString() : installedAt,
    managed: true,
    projectPath: normalizedProjectDir,
    version: CURRENT_HOOKWIRE_CONFIG_VERSION
  };
}

export async function detectAgents(options = {}) {
  const homeDir = normalizeHomeDir(options.homeDir);
  const projectDir = normalizeProjectDir(options.projectDir);

  return Promise.all(
    AGENT_DEFINITIONS.map(async (definition) => {
      const configPath = resolveConfigPath(homeDir, definition);
      const configExists = await isFile(configPath);
      const configDirExists = await isDirectory(path.dirname(configPath));

      return {
        agent: definition.agent,
        configDir: path.dirname(configPath),
        configExists,
        configPath,
        detected: configExists || configDirExists,
        displayName: definition.displayName,
        projectDir
      };
    })
  );
}

export async function runInit(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const homeDir = normalizeHomeDir(options.homeDir);
  const now = options.now ?? new Date();
  const projectDir = normalizeProjectDir(options.projectDir);
  const selectedAgents = normalizeSelectedAgents(options.selectedAgents);
  const detections = await detectAgents({ homeDir, projectDir });
  const detectionByAgent = new Map(detections.map((detection) => [detection.agent, detection]));
  const agents = [];

  for (const agent of selectedAgents) {
    const definition = getAgentDefinition(agent);
    const detection = detectionByAgent.get(agent);
    const configPath = resolveConfigPath(homeDir, definition);
    const backupPath = backupPathFor(configPath, now);

    if (!detection?.configExists) {
      const expected = expectedHookwireConfig({ agent, installedAt: now, projectDir });
      if (dryRun) {
        agents.push({
          action: "would_create",
          agent,
          backupCreated: false,
          backupPath: null,
          configPath,
          expected
        });
        continue;
      }

      try {
        await writeJsonNewFile(configPath, buildNextAgentConfig({ agent, config: {}, expected, projectDir }));
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error;
        }
        agents.push({
          action: "skipped_conflict",
          agent,
          backupCreated: false,
          backupPath: null,
          configPath,
          error: "Config file appeared before Hookwire could create it. Re-run init so it can be backed up before mutation."
        });
        continue;
      }

      agents.push({
        action: "created",
        agent,
        backupCreated: false,
        backupPath: null,
        configPath,
        expected
      });
      continue;
    }

    const loaded = await loadConfig(configPath);
    if (!loaded.ok) {
      agents.push({
        action: "skipped_invalid",
        agent,
        backupCreated: false,
        backupPath: null,
        configPath,
        error: loaded.error
      });
      continue;
    }

    const config = loaded.config;
    const existingInstalledAt = config.hookwire?.installedAt ?? now;
    const expected = expectedHookwireConfig({
      agent,
      installedAt: existingInstalledAt,
      projectDir
    });
    const nextConfig = buildNextAgentConfig({ agent, config, expected, projectDir });

    if (sameJson(config, nextConfig)) {
      agents.push({
        action: "unchanged",
        agent,
        backupCreated: false,
        backupPath: null,
        configPath,
        expected
      });
      continue;
    }

    if (dryRun) {
      agents.push({
        action: "would_update",
        agent,
        backupCreated: false,
        backupPath,
        configPath,
        expected
      });
      continue;
    }

    const existingMode = await fileMode(configPath);
    const createdBackupPath = await createBackup(configPath, now);
    await writeJsonAtomic(configPath, nextConfig, { mode: existingMode });
    agents.push({
      action: "updated",
      agent,
      backupCreated: true,
      backupPath: createdBackupPath,
      configPath,
      expected
    });
  }

  return {
    agents,
    detectedAgents: detections,
    dryRun,
    homeDir,
    projectDir
  };
}

export async function runDoctor(options = {}) {
  const homeDir = normalizeHomeDir(options.homeDir);
  const projectDir = normalizeProjectDir(options.projectDir);
  const detections = await detectAgents({ homeDir, projectDir });
  const agents = [];

  for (const detection of detections) {
    if (!detection.configExists) {
      agents.push({
        ...detection,
        actual: null,
        expected: expectedHookwireConfig({
          agent: detection.agent,
          installedAt: null,
          projectDir
        }),
        status: "missing_config"
      });
      continue;
    }

    const loaded = await loadConfig(detection.configPath);
    if (!loaded.ok) {
      agents.push({
        ...detection,
        actual: null,
        expected: expectedHookwireConfig({
          agent: detection.agent,
          installedAt: null,
          projectDir
        }),
        error: loaded.error,
        status: "invalid_config"
      });
      continue;
    }

    const actual = loaded.config.hookwire;
    const expected = expectedDoctorConfig({
      agent: detection.agent,
      installedAt: actual?.installedAt ?? null,
      projectDir
    });

    if (!isPlainObject(actual)) {
      agents.push({
        ...detection,
        actual: null,
        expected,
        status: "missing_hook"
      });
      continue;
    }

    if (Number(actual.version) < CURRENT_HOOKWIRE_CONFIG_VERSION) {
      agents.push({
        ...detection,
        actual,
        expected,
        status: "stale"
      });
      continue;
    }

    if (!matchesExpectedHookwireConfig(actual, expected) || !matchesAgentConfig(detection.agent, loaded.config, projectDir)) {
      agents.push({
        ...detection,
        actual: actualDoctorConfig(detection.agent, loaded.config),
        expected,
        status: "drifted"
      });
      continue;
    }

    agents.push({
      ...detection,
      actual: actualDoctorConfig(detection.agent, loaded.config),
      expected,
      status: "healthy"
    });
  }

  return {
    agents,
    homeDir,
    ok: agents.every((agent) => agent.status === "healthy"),
    projectDir
  };
}

function buildNextAgentConfig({ agent, config, expected, projectDir }) {
  const nextConfig = {
    ...config,
    hookwire: expected
  };

  if (agent === "claude") {
    nextConfig.hooks = mergeClaudeHooks(config.hooks, { projectDir });
  }

  return nextConfig;
}

function expectedDoctorConfig({ agent, installedAt, projectDir }) {
  const expected = expectedHookwireConfig({ agent, installedAt, projectDir });
  if (agent === "claude") {
    expected.claudeHooks = expectedClaudeHooks({ projectDir });
  }
  return expected;
}

function actualDoctorConfig(agent, config) {
  const actual = config.hookwire;
  if (!isPlainObject(actual)) {
    return actual;
  }
  if (agent !== "claude") {
    return actual;
  }
  return {
    ...actual,
    claudeHooks: isPlainObject(config.hooks) ? config.hooks : null
  };
}

function matchesAgentConfig(agent, config, projectDir) {
  if (agent !== "claude") {
    return true;
  }
  return claudeHooksMatch(config, { projectDir });
}

function normalizeSelectedAgents(selectedAgents) {
  if (!selectedAgents || selectedAgents.length === 0) {
    return supportedAgents();
  }

  return selectedAgents.map((agent) => normalizeAgent(agent));
}

function normalizeAgent(agent) {
  if (typeof agent !== "string" || agent.trim() === "") {
    throw new Error("Agent must be a non-empty string.");
  }

  const normalized = agent.trim().toLowerCase();
  getAgentDefinition(normalized);
  return normalized;
}

function getAgentDefinition(agent) {
  const definition = AGENT_BY_NAME.get(agent);
  if (!definition) {
    throw new Error(`Unsupported agent "${agent}". Supported agents: ${supportedAgents().join(", ")}.`);
  }
  return definition;
}

function normalizeHomeDir(homeDir) {
  return path.resolve(homeDir ?? os.homedir());
}

function normalizeProjectDir(projectDir) {
  return path.resolve(projectDir ?? process.cwd());
}

function resolveConfigPath(homeDir, definition) {
  return path.join(homeDir, ...definition.configSegments);
}

async function loadConfig(configPath) {
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    return {
      error: `Could not read config file: ${error.message}`,
      ok: false
    };
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    return {
      error: `Config file must contain valid JSON before Hookwire can modify it: ${error.message}`,
      ok: false
    };
  }

  if (!isPlainObject(config)) {
    return {
      error: "Config file must contain a JSON object before Hookwire can modify it.",
      ok: false
    };
  }

  return { config, ok: true };
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function backupPathFor(configPath, now) {
  const timestamp = (now instanceof Date ? now.toISOString() : String(now)).replace(/[:.]/g, "-");
  return path.join(path.dirname(configPath), ".hookwire-backups", `${path.basename(configPath)}.${timestamp}.bak`);
}

async function createBackup(configPath, now) {
  const firstPath = backupPathFor(configPath, now);
  await mkdir(path.dirname(firstPath), { recursive: true });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? firstPath : firstPath.replace(/\.bak$/, `.${attempt}.bak`);
    try {
      await copyFile(configPath, candidate, fsConstants.COPYFILE_EXCL);
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  throw new Error(`Could not create a unique Hookwire backup path for ${configPath}.`);
}

async function writeJsonNewFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const data = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, data, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
}

async function writeJsonAtomic(filePath, value, { mode }) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.hookwire-${randomUUID()}.tmp`);
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const writeOptions = {
    encoding: "utf8",
    flag: "wx",
    mode
  };

  try {
    await writeFile(tmpPath, data, writeOptions);
    await rename(tmpPath, filePath);
    await chmod(filePath, mode);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

async function fileMode(filePath) {
  return (await stat(filePath)).mode & 0o777;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchesExpectedHookwireConfig(actual, expected) {
  return (
    actual.adapterCommand === expected.adapterCommand &&
    actual.agent === expected.agent &&
    actual.installedAt === expected.installedAt &&
    actual.managed === expected.managed &&
    actual.projectPath === expected.projectPath &&
    actual.version === expected.version
  );
}
