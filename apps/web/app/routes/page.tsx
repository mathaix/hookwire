import { AppShell } from "../app-shell";
import { RouteBuilder } from "./route-builder";

export default function RoutesPage() {
  return (
    <AppShell active="routes" description="Configure web inbox and external approval delivery targets." title="Routes">
      <RouteBuilder />
    </AppShell>
  );
}
