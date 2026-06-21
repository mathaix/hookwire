import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ClaudeAdapterError,
  claudeDecisionOutput,
  claudeHooksMatch,
  expectedClaudeHooks,
  mergeClaudeHooks,
  normalizeClaudeHookPayload,
  runClaudeHook
} from "../../packages/agent-adapters/src/claude.mjs";

const cliPath = path.resolve("packages/installer/bin/hookwire.mjs");

const preToolUsePayload = {
  cwd: "/workspace/hookwire",
  hook_event_name: "PreToolUse",
  permission_mode: "default",
  session_id: "sess-claude-123",
  tool_input: {
    command: "npm test",
    description: "Run the test suite",
    timeout: 120000
  },
  tool_name: "Bash",
  tool_use_id: "toolu_01ABC",
  transcript_path: "/tmp/claude-transcript.jsonl"
};

const permissionRequestPayload = {
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
  session_id: "sess-claude-123",
  tool_input: {
    command: "npm test"
  },
  tool_name: "Bash",
  transcript_path: "/tmp/claude-transcript.jsonl"
};

const postToolUsePayload = {
  cwd: "/workspace/hookwire",
  duration_ms: 41,
  hook_event_name: "PostToolUse",
  permission_mode: "default",
  session_id: "sess-claude-123",
  tool_input: {
    file_path: "/workspace/hookwire/README.md"
  },
  tool_name: "Read",
  tool_response: {
    filePath: "/workspace/hookwire/README.md",
    success: true
  },
  tool_use_id: "toolu_01DEF",
  transcript_path: "/tmp/claude-transcript.jsonl"
};

describe("Claude Code adapter", () => {
  it("normalizes PreToolUse payloads into the Hookwire event envelope", () => {
    expect(normalizeClaudeHookPayload(preToolUsePayload, { eventName: "PreToolUse" })).toEqual({
      agent: "claude",
      cwd: "/workspace/hookwire",
      durationMs: null,
      eventType: "PreToolUse",
      permissionMode: "default",
      permissionSuggestions: [],
      schemaVersion: 1,
      sessionId: "sess-claude-123",
      toolInput: preToolUsePayload.tool_input,
      toolName: "Bash",
      toolResponse: null,
      toolUseId: "toolu_01ABC",
      transcriptPath: "/tmp/claude-transcript.jsonl"
    });
  });

  it("normalizes PermissionRequest payloads including permission suggestions", () => {
    const normalized = normalizeClaudeHookPayload(permissionRequestPayload, {
      eventName: "PermissionRequest"
    });

    expect(normalized).toMatchObject({
      agent: "claude",
      eventType: "PermissionRequest",
      permissionSuggestions: permissionRequestPayload.permission_suggestions,
      toolName: "Bash",
      toolUseId: null
    });
  });

  it("normalizes PostToolUse payloads for audit capture", () => {
    const normalized = normalizeClaudeHookPayload(postToolUsePayload, { eventName: "PostToolUse" });

    expect(normalized).toMatchObject({
      durationMs: 41,
      eventType: "PostToolUse",
      toolInput: postToolUsePayload.tool_input,
      toolResponse: postToolUsePayload.tool_response,
      toolUseId: "toolu_01DEF"
    });
  });

  it("maps allow, deny, and ask decisions to Claude PreToolUse JSON output", () => {
    expect(claudeDecisionOutput("PreToolUse", { decision: "allow", reason: "Safe command" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "Safe command"
      }
    });
    expect(claudeDecisionOutput("PreToolUse", { decision: "deny", reason: "Blocked" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Blocked"
      }
    });
    expect(claudeDecisionOutput("PreToolUse", { decision: "ask", reason: "Needs review" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Needs review"
      }
    });
    expect(
      claudeDecisionOutput("PreToolUse", {
        additionalContext: "Current environment: production",
        decision: "allow",
        updatedInput: { command: "npm run test:unit" }
      })
    ).toEqual({
      hookSpecificOutput: {
        additionalContext: "Current environment: production",
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: "npm run test:unit" }
      }
    });
  });

  it("maps PermissionRequest allow and deny decisions to Claude JSON output", () => {
    expect(
      claudeDecisionOutput("PermissionRequest", {
        decision: "allow",
        reason: "Approved by Hookwire",
        updatedInput: { command: "npm run lint" },
        updatedPermissions: permissionRequestPayload.permission_suggestions
      })
    ).toEqual({
      hookSpecificOutput: {
        decision: {
          behavior: "allow",
          message: "Approved by Hookwire",
          updatedInput: { command: "npm run lint" },
          updatedPermissions: permissionRequestPayload.permission_suggestions
        },
        hookEventName: "PermissionRequest"
      }
    });

    expect(claudeDecisionOutput("PermissionRequest", { decision: "deny", reason: "Denied" })).toEqual({
      hookSpecificOutput: {
        decision: {
          behavior: "deny",
          interrupt: false,
          message: "Denied"
        },
        hookEventName: "PermissionRequest"
      }
    });
    expect(claudeDecisionOutput("PermissionRequest", { decision: "ask" })).toEqual({
      systemMessage: "Hookwire left the Claude permission prompt active for human review."
    });
  });

  it("maps PostToolUse audit decisions without blocking successful audit capture by default", () => {
    expect(claudeDecisionOutput("PostToolUse", { decision: "ask" })).toBe(null);
    expect(claudeDecisionOutput("PostToolUse", { decision: "allow", reason: "Audit captured" })).toEqual({
      hookSpecificOutput: {
        additionalContext: "Audit captured",
        hookEventName: "PostToolUse"
      }
    });
    expect(
      claudeDecisionOutput("PostToolUse", {
        additionalContext: "Sanitized output recorded",
        decision: "allow",
        reason: "ignored because additionalContext wins"
      })
    ).toEqual({
      hookSpecificOutput: {
        additionalContext: "Sanitized output recorded",
        hookEventName: "PostToolUse"
      }
    });
    expect(claudeDecisionOutput("PostToolUse", { decision: "deny" })).toEqual({
      decision: "block",
      reason: "Blocked by Hookwire."
    });
  });

  it("fails malformed PreToolUse payloads closed with a Claude-compatible deny response", async () => {
    const result = await runClaudeHook({
      agent: "claude",
      decision: "allow",
      eventName: "PreToolUse",
      input: "{not json"
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Hookwire could not process Claude PreToolUse payload."
      }
    });
  });

  it("fails malformed PermissionRequest payloads closed and reports malformed PostToolUse safely", async () => {
    const permission = await runClaudeHook({
      agent: "claude",
      eventName: "PermissionRequest",
      input: JSON.stringify({ ...permissionRequestPayload, session_id: "" })
    });
    expect(JSON.parse(permission.stdout)).toEqual({
      hookSpecificOutput: {
        decision: {
          behavior: "deny",
          interrupt: false,
          message: "Hookwire could not process Claude PermissionRequest payload."
        },
        hookEventName: "PermissionRequest"
      }
    });

    const post = await runClaudeHook({
      agent: "claude",
      eventName: "PostToolUse",
      input: JSON.stringify({ ...postToolUsePayload, tool_response: null })
    });
    expect(JSON.parse(post.stdout)).toEqual({
      systemMessage: "Hookwire could not process Claude PostToolUse payload."
    });
  });

  it("returns an error for unsupported hook agents", async () => {
    const result = await runClaudeHook({
      agent: "codex",
      eventName: "PreToolUse",
      input: JSON.stringify(preToolUsePayload)
    });

    expect(result).toMatchObject({
      exitCode: 1,
      normalized: null,
      stderr: 'Unsupported hook agent "codex".\n',
      stdout: ""
    });
  });

  it("defaults valid PreToolUse hooks to ask when no decision is supplied", async () => {
    const result = await runClaudeHook({
      agent: "claude",
      eventName: "PreToolUse",
      input: JSON.stringify(preToolUsePayload)
    });

    expect(result.normalized).toMatchObject({ eventType: "PreToolUse", toolName: "Bash" });
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask"
      }
    });
  });

  it("fails invalid runtime decisions closed for valid PreToolUse payloads", async () => {
    const result = await runClaudeHook({
      agent: "claude",
      decision: "later",
      eventName: "PreToolUse",
      input: JSON.stringify(preToolUsePayload)
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Hookwire could not process Claude PreToolUse payload."
      }
    });
  });

  it("fails malformed hook payloads closed when the event option is missing", async () => {
    const result = await runClaudeHook({
      agent: "claude",
      input: "{not json"
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Hookwire could not process Claude PreToolUse payload."
      }
    });
  });

  it("rejects unsupported decisions, event mismatches, and malformed payload shapes", () => {
    expect(() => claudeDecisionOutput("PreToolUse", { decision: "later" })).toThrow(ClaudeAdapterError);
    expect(() => normalizeClaudeHookPayload(preToolUsePayload, { eventName: "PostToolUse" })).toThrow(
      "Expected Claude PostToolUse payload but received PreToolUse"
    );
    expect(() => normalizeClaudeHookPayload([], { eventName: "PreToolUse" })).toThrow("JSON object");
    expect(() => normalizeClaudeHookPayload("[]", { eventName: "PreToolUse" })).toThrow("JSON object");
    expect(() =>
      normalizeClaudeHookPayload({ ...preToolUsePayload, hook_event_name: "Stop" }, { eventName: "PreToolUse" })
    ).toThrow('Unsupported Claude hook event "Stop"');
    expect(() => normalizeClaudeHookPayload({ ...preToolUsePayload, tool_input: null })).toThrow("tool_input");
    expect(() => normalizeClaudeHookPayload({ ...preToolUsePayload, transcript_path: "" })).toThrow(
      "transcript_path"
    );
    expect(() => normalizeClaudeHookPayload({ ...postToolUsePayload, tool_response: null })).toThrow(
      "tool_response"
    );
  });

  it("merges Claude hooks without duplicating stale Hookwire handlers and validates required groups", () => {
    const projectDir = "/workspace/hookwire";
    const staleHookwire = {
      hooks: [
        {
          args: ["hook", "--agent", "claude", "--event", "PreToolUse", "--project", "/old"],
          command: "hookwire",
          type: "command"
        }
      ],
      matcher: "*"
    };
    const customHook = {
      hooks: [{ command: "echo custom", type: "command" }],
      matcher: "Bash"
    };

    const hooks = mergeClaudeHooks(
      {
        PermissionRequest: "not an array",
        PreToolUse: [staleHookwire, customHook]
      },
      { projectDir }
    );

    expect(hooks.PreToolUse).toEqual([expectedClaudeHooks({ projectDir }).PreToolUse[0], customHook]);
    expect(hooks.PermissionRequest).toEqual(expectedClaudeHooks({ projectDir }).PermissionRequest);
    expect(claudeHooksMatch({ hooks }, { projectDir })).toBe(true);
    expect(claudeHooksMatch({}, { projectDir })).toBe(false);
    expect(
      claudeHooksMatch(
        {
          hooks: {
            ...hooks,
            PostToolUse: []
          }
        },
        { projectDir }
      )
    ).toBe(false);
  });

  it("invokes the Claude hook command over stdin and emits only JSON on stdout", async () => {
    const result = await runCli(
      ["hook", "--agent", "claude", "--event", "PreToolUse", "--decision", "deny", "--reason", "Policy"],
      JSON.stringify(preToolUsePayload)
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Policy"
      }
    });
  });
});

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
