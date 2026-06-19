import { Suspense } from "react";
import { AppShell } from "./app-shell";
import { ApprovalInbox } from "./approvals/approval-inbox";

export default function InboxPage() {
  return (
    <AppShell
      active="inbox"
      description="Review routed agent actions, inspect context, and record a decision."
      title="Pending approvals"
    >
      <Suspense fallback={<section className="panel approval-state-panel">Loading approval requests</section>}>
        <ApprovalInbox />
      </Suspense>
    </AppShell>
  );
}
