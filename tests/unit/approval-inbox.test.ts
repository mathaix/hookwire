import { describe, expect, it } from "vitest";
import {
  canReviewerDecide,
  createApprovalInbox,
  decideApproval,
  getApprovalQuerySnapshot,
  getPendingApprovals,
  getSelectedApproval,
  redactPayload
} from "../../apps/web/app/approvals/domain";

const knownSecret = "sk-live-super-secret";

describe("approval inbox domain", () => {
  it("seeds pending, expired, and empty inbox states", () => {
    const inbox = createApprovalInbox();

    expect(getPendingApprovals(inbox).map((approval) => approval.id)).toEqual(["APR-1042", "APR-1041"]);
    expect(getSelectedApproval(inbox, "APR-1041")).toMatchObject({ id: "APR-1041" });
    expect(getSelectedApproval(inbox, "missing-id")).toMatchObject({ id: "APR-1042" });
    expect(canReviewerDecide(inbox, getSelectedApproval(inbox, "APR-1042")!)).toBe(true);
    expect(canReviewerDecide(createApprovalInbox({ persona: "viewer" }), getSelectedApproval(inbox, "APR-1042")!)).toBe(
      false
    );
    expect(inbox.approvals.find((approval) => approval.id === "APR-1039")).toMatchObject({
      id: "APR-1039",
      status: "expired"
    });
    expect(createApprovalInbox({ scenario: "empty" }).approvals).toEqual([]);
    expect(getSelectedApproval(createApprovalInbox({ scenario: "empty" }))).toBeNull();
  });

  it("approves a pending request exactly once and creates matching query rows", () => {
    const firstDecision = decideApproval(createApprovalInbox(), {
      approvalId: "APR-1042",
      decision: "approved"
    });

    expect(firstDecision.result).toMatchObject({ ok: true, code: "decided" });
    expect(firstDecision.state.approvals.find((approval) => approval.id === "APR-1042")).toMatchObject({
      status: "approved"
    });
    expect(firstDecision.state.decisions).toHaveLength(1);
    expect(firstDecision.state.auditEvents).toHaveLength(1);

    const secondDecision = decideApproval(firstDecision.state, {
      approvalId: "APR-1042",
      decision: "denied",
      reason: "Trying to duplicate a decision"
    });

    expect(secondDecision.result).toMatchObject({ ok: false, code: "already_decided" });
    expect(secondDecision.state.decisions).toHaveLength(1);
    expect(secondDecision.state.auditEvents).toHaveLength(1);

    const rows = getApprovalQuerySnapshot(secondDecision.state, "APR-1042");
    expect(rows.approval_requests).toEqual([
      expect.objectContaining({ id: "APR-1042", status: "approved", risk_level: "high" })
    ]);
    expect(rows.approval_decisions).toEqual([
      expect.objectContaining({
        approval_request_id: "APR-1042",
        decision: "approved",
        scope: "once",
        source: "web"
      })
    ]);
    expect(rows.audit_events).toEqual([
      expect.objectContaining({
        entity_id: "APR-1042",
        entity_type: "approval_request",
        event_type: "approval.approved"
      })
    ]);
  });

  it("requires a denial reason when configured and denies exactly once", () => {
    const missingReason = decideApproval(createApprovalInbox(), {
      approvalId: "APR-1041",
      decision: "denied"
    });

    expect(missingReason.result).toMatchObject({ ok: false, code: "reason_required" });
    expect(missingReason.state.decisions).toHaveLength(0);

    const denied = decideApproval(missingReason.state, {
      approvalId: "APR-1041",
      decision: "denied",
      reason: "Relay config patch touches protected routing"
    });

    expect(denied.result).toMatchObject({ ok: true, code: "decided" });
    expect(denied.state.approvals.find((approval) => approval.id === "APR-1041")).toMatchObject({
      status: "denied"
    });
    expect(denied.state.decisions).toHaveLength(1);
    expect(denied.state.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "approval.denied",
        metadata: expect.objectContaining({ reasonRequired: true })
      })
    ]);

    const duplicate = decideApproval(denied.state, {
      approvalId: "APR-1041",
      decision: "approved"
    });

    expect(duplicate.result).toMatchObject({ ok: false, code: "already_decided" });
    expect(duplicate.state.decisions).toHaveLength(1);
    expect(duplicate.state.auditEvents).toHaveLength(1);
  });

  it("blocks expired and unauthorized decisions", () => {
    const missing = decideApproval(createApprovalInbox(), {
      approvalId: "APR-0000",
      decision: "approved"
    });

    expect(missing.result).toMatchObject({ ok: false, code: "not_found" });

    const expired = decideApproval(createApprovalInbox(), {
      approvalId: "APR-1039",
      decision: "approved"
    });

    expect(expired.result).toMatchObject({ ok: false, code: "expired" });
    expect(expired.state.decisions).toHaveLength(0);

    const unauthorized = decideApproval(createApprovalInbox({ persona: "viewer" }), {
      approvalId: "APR-1042",
      decision: "approved"
    });

    expect(unauthorized.result).toMatchObject({ ok: false, code: "unauthorized" });
    expect(unauthorized.state.decisions).toHaveLength(0);
  });

  it("redacts known secret fixture values before payloads can reach the inbox", () => {
    const payload = redactPayload({
      command: `curl -H "Authorization: Bearer ${knownSecret}" https://api.example.test`,
      databaseUrl: "postgres://hookwire:local-dev-password@localhost:5432/hookwire",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtYXlhIn0.sQ1qzLgmbV5eVTK3yZ0uJ92vQU0fPg",
      awsAccessKey: "AKIA1234567890ABCDEF",
      credentials: {
        value: "nested-password-value",
        host: "db.internal"
      },
      queryString: "password=local-dev-password&safe=true",
      secret: ["nested-array-secret"],
      values: [knownSecret, 42, null, true],
      env: {
        HOOKWIRE_TOKEN: knownSecret,
        SAFE_FLAG: "true"
      },
      nested: {
        githubToken: knownSecret
      }
    });

    const renderedPayload = JSON.stringify(payload);

    expect(renderedPayload).not.toContain(knownSecret);
    expect(renderedPayload).not.toContain("local-dev-password");
    expect(renderedPayload).not.toContain("nested-password-value");
    expect(renderedPayload).not.toContain("nested-array-secret");
    expect(renderedPayload).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(renderedPayload).not.toContain("AKIA1234567890ABCDEF");
    expect(renderedPayload).toContain("[redacted]");
    expect(payload).toMatchObject({
      databaseUrl: "postgres://hookwire:[redacted]@localhost:5432/hookwire",
      jwt: "[redacted]",
      awsAccessKey: "[redacted]",
      credentials: "[redacted]",
      queryString: "password=[redacted]&safe=true",
      secret: "[redacted]",
      env: {
        HOOKWIRE_TOKEN: "[redacted]",
        SAFE_FLAG: "true"
      },
      values: ["[redacted]", 42, null, true],
      nested: {
        githubToken: "[redacted]"
      }
    });
  });
});
