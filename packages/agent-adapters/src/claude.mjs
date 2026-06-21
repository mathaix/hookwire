import path from "node:path";

export const CLAUDE_HOOK_CONFIG_VERSION = 1;
export const CLAUDE_HOOK_EVENTS = Object.freeze(["PreToolUse", "PermissionRequest", "PostToolUse"]);

const DECISIONS = new Set(["allow", "deny", "ask"]);

export class ClaudeAdapterError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClaudeAdapterError";
  }
}

export function expectedClaudeHookCommand({ eventName, projectDir }) {
  const normalizedEvent = normalizeClaudeEventName(eventName);
  return {
    args: ["hook", "--agent", "claude", "--event", normalizedEvent, "--project", path.resolve(projectDir)],
    command: "hookwire",
    statusMessage: "Checking Hookwire approval policy",
    timeout: 60,
    type: "command"
  };
}

export function expectedClaudeHooks({ projectDir }) {
  return Object.fromEntries(
    CLAUDE_HOOK_EVENTS.map((eventName) => [
      eventName,
      [
        {
          hooks: [expectedClaudeHookCommand({ eventName, projectDir })],
          matcher: "*"
        }
      ]
    ])
  );
}

export function mergeClaudeHooks(existingHooks, { projectDir }) {
  const nextHooks = cloneHooksObject(existingHooks);
  const expected = expectedClaudeHooks({ projectDir });

  for (const eventName of CLAUDE_HOOK_EVENTS) {
    const existingGroups = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : [];
    const withoutHookwire = existingGroups.filter((group) => !isHookwireClaudeGroup(group, eventName));
    nextHooks[eventName] = [...expected[eventName], ...withoutHookwire];
  }

  return nextHooks;
}

export function claudeHooksMatch(settings, { projectDir }) {
  if (!isPlainObject(settings?.hooks)) {
    return false;
  }

  const expected = expectedClaudeHooks({ projectDir });
  for (const eventName of CLAUDE_HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[eventName])) {
      return false;
    }
    if (!settings.hooks[eventName].some((group) => sameJson(group, expected[eventName][0]))) {
      return false;
    }
  }
  return true;
}

export function normalizeClaudeHookPayload(input, options = {}) {
  const payload = parsePayload(input);
  const expectedEventName = options.eventName ? normalizeClaudeEventName(options.eventName) : null;
  const eventName = normalizeClaudeEventName(payload.hook_event_name);

  if (expectedEventName && eventName !== expectedEventName) {
    throw new ClaudeAdapterError(`Expected Claude ${expectedEventName} payload but received ${eventName}.`);
  }

  requireString(payload.session_id, "session_id");
  requireString(payload.transcript_path, "transcript_path");
  requireString(payload.cwd, "cwd");
  requireString(payload.tool_name, "tool_name");
  if (!isPlainObject(payload.tool_input)) {
    throw new ClaudeAdapterError("Claude hook payload field tool_input must be an object.");
  }
  if (eventName === "PostToolUse" && !isPlainObject(payload.tool_response)) {
    throw new ClaudeAdapterError("Claude PostToolUse payload field tool_response must be an object.");
  }

  return {
    agent: "claude",
    cwd: payload.cwd,
    durationMs: typeof payload.duration_ms === "number" ? payload.duration_ms : null,
    eventType: eventName,
    permissionMode: typeof payload.permission_mode === "string" ? payload.permission_mode : null,
    permissionSuggestions: Array.isArray(payload.permission_suggestions) ? payload.permission_suggestions : [],
    schemaVersion: 1,
    sessionId: payload.session_id,
    toolInput: payload.tool_input,
    toolName: payload.tool_name,
    toolResponse: eventName === "PostToolUse" ? payload.tool_response : null,
    toolUseId: typeof payload.tool_use_id === "string" ? payload.tool_use_id : null,
    transcriptPath: payload.transcript_path
  };
}

export function claudeDecisionOutput(eventName, decisionInput = {}) {
  const normalizedEvent = normalizeClaudeEventName(eventName);
  const decision = normalizeDecision(decisionInput.decision ?? "ask");
  const reason = decisionInput.reason;

  if (normalizedEvent === "PreToolUse") {
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision
      }
    };
    if (reason) {
      output.hookSpecificOutput.permissionDecisionReason = reason;
    }
    if (decision === "allow" && isPlainObject(decisionInput.updatedInput)) {
      output.hookSpecificOutput.updatedInput = decisionInput.updatedInput;
    }
    if (decisionInput.additionalContext) {
      output.hookSpecificOutput.additionalContext = decisionInput.additionalContext;
    }
    return output;
  }

  if (normalizedEvent === "PermissionRequest") {
    if (decision === "ask") {
      return {
        systemMessage: "Hookwire left the Claude permission prompt active for human review."
      };
    }

    const permissionDecision = {
      behavior: decision === "allow" ? "allow" : "deny",
      message: reason ?? (decision === "allow" ? "Approved by Hookwire." : "Denied by Hookwire.")
    };
    if (decision === "deny") {
      permissionDecision.interrupt = false;
    }
    if (decision === "allow" && isPlainObject(decisionInput.updatedInput)) {
      permissionDecision.updatedInput = decisionInput.updatedInput;
    }
    if (decision === "allow" && Array.isArray(decisionInput.updatedPermissions)) {
      permissionDecision.updatedPermissions = decisionInput.updatedPermissions;
    }

    return {
      hookSpecificOutput: {
        decision: permissionDecision,
        hookEventName: "PermissionRequest"
      }
    };
  }

  if (decision === "deny") {
    return {
      decision: "block",
      reason: reason ?? "Blocked by Hookwire."
    };
  }

  if (reason || decisionInput.additionalContext) {
    return {
      hookSpecificOutput: {
        additionalContext: decisionInput.additionalContext ?? reason,
        hookEventName: "PostToolUse"
      }
    };
  }

  return null;
}

export async function runClaudeHook({ agent, decision, eventName, input, reason }) {
  if (agent !== "claude") {
    return {
      exitCode: 1,
      normalized: null,
      stderr: `Unsupported hook agent "${agent}".\n`,
      stdout: ""
    };
  }

  let normalized;
  try {
    normalized = normalizeClaudeHookPayload(input, { eventName });
  } catch {
    const output = safeFailureOutput(eventName);
    return {
      exitCode: 0,
      normalized: null,
      stderr: "",
      stdout: `${JSON.stringify(output)}\n`
    };
  }

  let output;
  try {
    output = claudeDecisionOutput(normalized.eventType, {
      decision: decision ?? "ask",
      reason
    });
  } catch {
    output = safeFailureOutput(normalized.eventType);
  }

  return {
    exitCode: 0,
    normalized,
    stderr: "",
    stdout: output ? `${JSON.stringify(output)}\n` : ""
  };
}

function safeFailureOutput(eventName) {
  const normalizedEvent = safeClaudeEventName(eventName);
  if (normalizedEvent === "PreToolUse") {
    return claudeDecisionOutput("PreToolUse", {
      decision: "deny",
      reason: "Hookwire could not process Claude PreToolUse payload."
    });
  }
  if (normalizedEvent === "PermissionRequest") {
    return claudeDecisionOutput("PermissionRequest", {
      decision: "deny",
      reason: "Hookwire could not process Claude PermissionRequest payload."
    });
  }
  return {
    systemMessage: "Hookwire could not process Claude PostToolUse payload."
  };
}

function safeClaudeEventName(eventName) {
  try {
    return normalizeClaudeEventName(eventName);
  } catch {
    return "PreToolUse";
  }
}

function parsePayload(input) {
  if (typeof input !== "string") {
    if (!isPlainObject(input)) {
      throw new ClaudeAdapterError("Claude hook payload must be a JSON object.");
    }
    return input;
  }

  try {
    const parsed = JSON.parse(input);
    if (!isPlainObject(parsed)) {
      throw new ClaudeAdapterError("Claude hook payload must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof ClaudeAdapterError) {
      throw error;
    }
    throw new ClaudeAdapterError("Claude hook payload must be valid JSON.");
  }
}

function normalizeClaudeEventName(eventName) {
  if (!CLAUDE_HOOK_EVENTS.includes(eventName)) {
    throw new ClaudeAdapterError(`Unsupported Claude hook event "${eventName}".`);
  }
  return eventName;
}

function normalizeDecision(decision) {
  if (!DECISIONS.has(decision)) {
    throw new ClaudeAdapterError(`Unsupported Hookwire decision "${decision}".`);
  }
  return decision;
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ClaudeAdapterError(`Claude hook payload field ${fieldName} must be a non-empty string.`);
  }
}

function cloneHooksObject(hooks) {
  if (!isPlainObject(hooks)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(hooks).map(([eventName, groups]) => [
      eventName,
      Array.isArray(groups) ? groups.map((group) => cloneJson(group)) : groups
    ])
  );
}

function isHookwireClaudeGroup(group, eventName) {
  if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
    return false;
  }
  return group.hooks.some(
    (hook) =>
      isPlainObject(hook) &&
      hook.command === "hookwire" &&
      Array.isArray(hook.args) &&
      hook.args[0] === "hook" &&
      hook.args[1] === "--agent" &&
      hook.args[2] === "claude" &&
      hook.args.includes(eventName)
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
