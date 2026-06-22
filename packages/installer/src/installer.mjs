import { constants as fsConstants } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  CLAUDE_HOOK_EVENTS,
  claudeHooksMatch,
  expectedClaudeHooks,
  mergeClaudeHooks,
  removeClaudeHooks
} from "../../agent-adapters/src/claude.mjs";

export const CURRENT_HOOKWIRE_CONFIG_VERSION = 2;

export const INTEGRATION_TIERS = Object.freeze({
  AWARENESS_ONLY: "awareness_only",
  ENFORCEMENT_HOOK: "enforcement_hook",
  PLUGIN_ADAPTER: "plugin_adapter"
});

export const FAILURE_MODES = Object.freeze({
  ADVISORY: "advisory",
  FAIL_CLOSED: "fail_closed"
});

const PATCH_MODES = new Set(["auto", "manual"]);

export const AGENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    agent: "claude",
    configSegments: [".claude", "settings.json"],
    displayName: "Claude Code",
    failureMode: FAILURE_MODES.FAIL_CLOSED,
    integrationTier: INTEGRATION_TIERS.ENFORCEMENT_HOOK
  }),
  Object.freeze({
    agent: "codex",
    configSegments: [".codex", "config.json"],
    displayName: "Codex",
    failureMode: FAILURE_MODES.ADVISORY,
    integrationTier: INTEGRATION_TIERS.AWARENESS_ONLY
  }),
  Object.freeze({
    agent: "openclaw",
    configSegments: [".openclaw", "config.json"],
    displayName: "OpenClaw",
    failureMode: FAILURE_MODES.FAIL_CLOSED,
    integrationTier: INTEGRATION_TIERS.PLUGIN_ADAPTER
  })
]);

const AGENT_BY_NAME = new Map(AGENT_DEFINITIONS.map((definition) => [definition.agent, definition]));

export function supportedAgents() {
  return AGENT_DEFINITIONS.map((definition) => definition.agent);
}

export function expectedHookwireConfig({ agent, installedAt = new Date(), projectDir }) {
  const normalizedAgent = normalizeAgent(agent);
  const definition = getAgentDefinition(normalizedAgent);
  const normalizedProjectDir = normalizeProjectDir(projectDir);
  return {
    adapterCommand: `hookwire relay --agent ${normalizedAgent} --project ${normalizedProjectDir}`,
    agent: normalizedAgent,
    failureMode: definition.failureMode,
    installedAt: installedAt instanceof Date ? installedAt.toISOString() : installedAt,
    integrationTier: definition.integrationTier,
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
        failureMode: definition.failureMode,
        integrationTier: definition.integrationTier,
        projectDir
      };
    })
  );
}

export async function runInit(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const homeDir = normalizeHomeDir(options.homeDir);
  const now = options.now ?? new Date();
  const patchMode = normalizePatchMode(options.patchMode);
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
      const nextConfig = buildNextAgentConfig({
        agent,
        config: {},
        expected: expectedHookwireConfig({ agent, installedAt: now, projectDir }),
        projectDir
      });
      const expected = nextConfig.hookwire;
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
      if (patchMode === "manual") {
        agents.push({
          action: "manual_create",
          agent,
          backupCreated: false,
          backupPath: null,
          configPath,
          expected,
          manualInstructions: manualPatchInstructions("create", configPath)
        });
        continue;
      }

      try {
        await writeJsonNewFile(configPath, nextConfig);
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
    const nextConfig = buildNextAgentConfig({
      agent,
      config,
      expected: expectedHookwireConfig({
        agent,
        installedAt: existingInstalledAt,
        projectDir
      }),
      projectDir
    });
    const expected = nextConfig.hookwire;

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
    if (patchMode === "manual") {
      agents.push({
        action: "manual_update",
        agent,
        backupCreated: false,
        backupPath,
        configPath,
        expected,
        manualInstructions: manualPatchInstructions("update", configPath)
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
    patchMode,
    projectDir
  };
}

export async function runUninstall(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const homeDir = normalizeHomeDir(options.homeDir);
  const now = options.now ?? new Date();
  const patchMode = normalizePatchMode(options.patchMode);
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
      agents.push({
        action: "missing",
        agent,
        backupCreated: false,
        backupPath: null,
        configPath
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

    const nextConfig = removeNextAgentConfig({ agent, config: loaded.config });
    if (sameJson(loaded.config, nextConfig)) {
      agents.push({
        action: "unchanged",
        agent,
        backupCreated: false,
        backupPath: null,
        configPath
      });
      continue;
    }

    if (dryRun) {
      agents.push({
        action: "would_remove",
        agent,
        backupCreated: false,
        backupPath,
        configPath
      });
      continue;
    }
    if (patchMode === "manual") {
      agents.push({
        action: "manual_remove",
        agent,
        backupCreated: false,
        backupPath,
        configPath,
        manualInstructions: manualPatchInstructions("remove", configPath)
      });
      continue;
    }

    const existingMode = await fileMode(configPath);
    const createdBackupPath = await createBackup(configPath, now);
    await writeJsonAtomic(configPath, nextConfig, { mode: existingMode });
    agents.push({
      action: "removed",
      agent,
      backupCreated: true,
      backupPath: createdBackupPath,
      configPath
    });
  }

  return {
    agents,
    detectedAgents: detections,
    dryRun,
    homeDir,
    patchMode,
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

    if (!matchesExpectedHookwireConfig(actual, expected)) {
      agents.push({
        ...detection,
        actual: actualDoctorConfig(detection.agent, loaded.config),
        expected,
        status: "drifted"
      });
      continue;
    }

    const integrity = managedIntegrityCheck(detection.agent, loaded.config);
    if (integrity.status !== "verified") {
      agents.push({
        ...detection,
        actual: actualDoctorConfig(detection.agent, loaded.config, integrity),
        expected,
        status: "tampered"
      });
      continue;
    }

    if (!matchesAgentConfig(detection.agent, loaded.config, projectDir)) {
      agents.push({
        ...detection,
        actual: actualDoctorConfig(detection.agent, loaded.config, integrity),
        expected,
        status: "drifted"
      });
      continue;
    }

    agents.push({
      ...detection,
      actual: actualDoctorConfig(detection.agent, loaded.config, integrity),
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

  nextConfig.hookwire = {
    ...nextConfig.hookwire,
    integrity: managedIntegrityForConfig(agent, nextConfig)
  };

  return nextConfig;
}

function expectedDoctorConfig({ agent, installedAt, projectDir }) {
  const expectedConfig = buildNextAgentConfig({
    agent,
    config: {},
    expected: expectedHookwireConfig({ agent, installedAt, projectDir }),
    projectDir
  });
  const expected = expectedConfig.hookwire;
  if (agent === "claude") {
    expected.claudeHooks = expectedClaudeHooks({ projectDir });
  }
  return expected;
}

function actualDoctorConfig(agent, config, integrity = managedIntegrityCheck(agent, config)) {
  const actual = config.hookwire;
  if (!isPlainObject(actual)) {
    return actual;
  }
  const withIntegrityCheck = {
    ...actual,
    integrityCheck: integrity
  };
  if (agent !== "claude") {
    return withIntegrityCheck;
  }
  return {
    ...withIntegrityCheck,
    claudeHooks: isPlainObject(config.hooks) ? config.hooks : null
  };
}

function removeNextAgentConfig({ agent, config }) {
  const nextConfig = { ...config };
  delete nextConfig.hookwire;
  if (agent === "claude") {
    const nextHooks = removeClaudeHooks(config.hooks);
    if (nextHooks) {
      nextConfig.hooks = nextHooks;
    } else {
      delete nextConfig.hooks;
    }
  }
  return nextConfig;
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

function normalizePatchMode(patchMode) {
  const normalized = patchMode ?? "auto";
  if (!PATCH_MODES.has(normalized)) {
    throw new Error(`Unsupported patch mode "${patchMode}". Supported patch modes: ${[...PATCH_MODES].join(", ")}.`);
  }
  return normalized;
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

function manualPatchInstructions(action, configPath) {
  return `Manual patch mode selected: ${action} the Hookwire-managed section in ${configPath}, or rerun without --no-patch to let Hookwire update it.`;
}

function managedIntegrityForConfig(agent, config) {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(stableJson(managedIntegrityPayload(agent, config))).digest("hex")
  };
}

function managedIntegrityCheck(agent, config) {
  const expected = managedIntegrityForConfig(agent, config);
  const actual = config.hookwire?.integrity;
  if (!isPlainObject(actual)) {
    return {
      actual: null,
      expected,
      status: "missing_integrity"
    };
  }
  if (actual.algorithm !== expected.algorithm || actual.value !== expected.value) {
    return {
      actual,
      expected,
      status: "tampered"
    };
  }
  return {
    actual,
    expected,
    status: "verified"
  };
}

function managedIntegrityPayload(agent, config) {
  const payload = {
    hookwire: stripIntegrity(config.hookwire)
  };
  if (agent === "claude") {
    payload.claudeHooks = managedClaudeHooksForIntegrity(config);
  }
  return payload;
}

function stripIntegrity(hookwireConfig) {
  const clone = { ...hookwireConfig };
  delete clone.integrity;
  return clone;
}

function managedClaudeHooksForIntegrity(config) {
  const hooks = isPlainObject(config.hooks) ? config.hooks : {};
  return Object.fromEntries(
    CLAUDE_HOOK_EVENTS.map((eventName) => [
      eventName,
      Array.isArray(hooks[eventName])
        ? hooks[eventName].filter((group) => isHookwireClaudeGroupForIntegrity(group, eventName))
        : []
    ])
  );
}

function isHookwireClaudeGroupForIntegrity(group, eventName) {
  return (
    isPlainObject(group) &&
    Array.isArray(group.hooks) &&
    group.hooks.some((hook) => isHookwireClaudeCommandForIntegrity(hook, eventName))
  );
}

function isHookwireClaudeCommandForIntegrity(hook, eventName) {
  return (
    isPlainObject(hook) &&
    hook.command === "hookwire" &&
    Array.isArray(hook.args) &&
    hook.args.length === 7 &&
    hook.args[0] === "hook" &&
    hook.args[1] === "--agent" &&
    hook.args[2] === "claude" &&
    hook.args[3] === "--event" &&
    hook.args[4] === eventName &&
    hook.args[5] === "--project" &&
    typeof hook.args[6] === "string"
  );
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
    actual.failureMode === expected.failureMode &&
    actual.installedAt === expected.installedAt &&
    actual.integrationTier === expected.integrationTier &&
    actual.managed === expected.managed &&
    actual.projectPath === expected.projectPath &&
    actual.version === expected.version
  );
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}
