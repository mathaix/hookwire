import { AppShell } from "../app-shell";
import { PolicyBuilder } from "./policy-builder";

export default function PoliciesPage() {
  return (
    <AppShell active="policies" description="Review rule sets that decide when approvals are required." title="Policies">
      <PolicyBuilder />
    </AppShell>
  );
}
