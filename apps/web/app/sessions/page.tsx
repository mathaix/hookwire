import { Suspense } from "react";
import { AppShell } from "../app-shell";
import { SessionExplorer } from "./session-explorer";

export default function SessionsPage() {
  return (
    <AppShell active="sessions" description="Inspect agent sessions across projects and tools." title="Sessions">
      <Suspense fallback={<section className="panel approval-state-panel">Loading sessions</section>}>
        <SessionExplorer />
      </Suspense>
    </AppShell>
  );
}
