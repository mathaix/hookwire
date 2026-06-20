import { AppShell } from "../app-shell";
import { AuditTimeline } from "./audit-timeline";

export default function AuditPage() {
  return (
    <AppShell active="audit" description="Track approval, session, route, and identity changes." title="Audit timeline">
      <AuditTimeline />
    </AppShell>
  );
}
