export type SectionKey = "inbox" | "sessions" | "policies" | "routes" | "integrations" | "audit" | "settings";

export const navItems: Array<{ key: SectionKey; label: string; href: string; glyph: string }> = [
  { key: "inbox", label: "Inbox", href: "/", glyph: "IN" },
  { key: "sessions", label: "Sessions", href: "/sessions", glyph: "SE" },
  { key: "policies", label: "Policies", href: "/policies", glyph: "PO" },
  { key: "routes", label: "Routes", href: "/routes", glyph: "RO" },
  { key: "integrations", label: "Integrations", href: "/integrations", glyph: "IT" },
  { key: "audit", label: "Audit", href: "/audit", glyph: "AU" },
  { key: "settings", label: "Settings", href: "/settings", glyph: "ST" }
];

export const approvals = [
  {
    id: "APR-1042",
    project: "hookwire/web",
    agent: "Codex",
    risk: "High",
    requested: "2m ago",
    summary: "Apply migration and write project settings",
    route: "Web inbox",
    session: "codex-7f31",
    requester: "maya@acme.dev"
  },
  {
    id: "APR-1041",
    project: "infra/relay",
    agent: "Claude Code",
    risk: "Medium",
    requested: "9m ago",
    summary: "Patch local relay config",
    route: "On-call reviewers",
    session: "claude-a88c",
    requester: "shared relay"
  },
  {
    id: "APR-1040",
    project: "openclaw/adapters",
    agent: "OpenClaw",
    risk: "Low",
    requested: "14m ago",
    summary: "Read adapter manifest",
    route: "Web inbox",
    session: "openclaw-19b2",
    requester: "sam@acme.dev"
  }
];

export const sessions = [
  { id: "codex-7f31", agent: "Codex", owner: "Maya", branch: "codex/issue-003-web-app-shell", status: "Awaiting approval" },
  { id: "claude-a88c", agent: "Claude Code", owner: "Shared relay", branch: "main", status: "Reviewing hook config" },
  { id: "openclaw-19b2", agent: "OpenClaw", owner: "Sam", branch: "adapter-probe", status: "Idle" }
];

export const routeHealth = [
  { name: "Web inbox", target: "web_inbox", status: "Active", latency: "1.2s" },
  { name: "On-call reviewers", target: "slack", status: "Modeled", latency: "worker pending" },
  { name: "Fallback terminal", target: "local_terminal", status: "Draft", latency: "local" }
];

export const auditEvents = [
  { event: "approval.requested", actor: "codex-7f31", time: "2m ago" },
  { event: "route.evaluated", actor: "policy v3", time: "2m ago" },
  { event: "session.claimed", actor: "maya@acme.dev", time: "18m ago" }
];

export const policies = [
  { name: "Default write guard", status: "Active", rules: 8, defaultDecision: "Ask" },
  { name: "Safe read allowlist", status: "Draft", rules: 5, defaultDecision: "Allow" },
  { name: "Production deploy lock", status: "Active", rules: 3, defaultDecision: "Deny" }
];

export const integrations = [
  { provider: "Web inbox", status: "Active", owner: "Control plane" },
  { provider: "Slack", status: "Modeled", owner: "Platform on-call" },
  { provider: "Jira", status: "Modeled", owner: "Release desk" },
  { provider: "Linear", status: "Modeled", owner: "Product ops" }
];
